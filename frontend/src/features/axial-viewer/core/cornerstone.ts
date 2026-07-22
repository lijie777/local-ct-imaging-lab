export interface CornerstoneModules {
  core: typeof import('@cornerstonejs/core')
  loader: typeof import('@cornerstonejs/dicom-image-loader')
  tools: typeof import('@cornerstonejs/tools')
}

export interface AxialViewportRuntime {
  activateTool(tool: import('../model/axialViewer').ViewerTool): void
  destroy(): void
  next(): Promise<void>
  previous(): Promise<void>
  reset(): Promise<void>
  resize(): void
  retry(): Promise<void>
}

let initialization: Promise<CornerstoneModules> | null = null
let runtimeSequence = 0
const registeredTools = new Set<string>()
const activeDicomRequests = new Map<string, Set<XMLHttpRequest>>()


function workerCount(): number {
  return Math.max(1, Math.min(2, navigator.hardwareConcurrency ?? 1))
}

export function initializeCornerstone(): Promise<CornerstoneModules> {
  initialization ??= Promise.all([
    import('@cornerstonejs/core'),
    import('@cornerstonejs/dicom-image-loader'),
    import('@cornerstonejs/tools'),
  ]).then(([core, loader, tools]) => {
    core.init()
    loader.init({
      beforeSend: (xhr, imageId) => {
        const requests = activeDicomRequests.get(imageId) ?? new Set()
        requests.add(xhr)
        activeDicomRequests.set(imageId, requests)
      },
      maxWebWorkers: workerCount(),
      onloadend: (event, params) => {
        const imageId = (params as { imageId?: string }).imageId
        if (imageId !== undefined) {
          const requests = activeDicomRequests.get(imageId)
          if (requests !== undefined) {
            requests.delete(event.currentTarget as XMLHttpRequest)
            if (requests.size === 0) {
              activeDicomRequests.delete(imageId)
            }
          }
        }
      },
    })
    tools.init()
    return { core, loader, tools }
  })
  return initialization
}

export function abortPendingDicomLoads(imageIds: readonly string[]): void {
  for (const imageId of imageIds) {
    const requests = activeDicomRequests.get(imageId)
    if (requests === undefined) {
      continue
    }
    for (const xhr of [...requests]) {
      if (xhr.readyState !== 4) {
        xhr.abort()
      }
    }
    activeDicomRequests.delete(imageId)
  }
}

function abortError(): DOMException {
  return new DOMException('Axial viewport creation cancelled', 'AbortError')
}

const viewerErrorByStatus: Record<number, string> = {
  0: '无法连接本机服务，请确认服务已启动',
  404: '未找到该影像实例，请返回病人管理',
  409: '该序列暂不可查看，请返回病人管理',
  410: '本机 DICOM 文件缺失，请恢复文件后重试或返回病人管理',
  422: '影像请求无效，请返回病人管理',
  500: '本机影像服务异常，请重试或返回病人管理',
}

const decodeErrorMessage = '无法解码该影像，请重试或返回病人管理'
const safeViewerMessages = new Set([
  ...Object.values(viewerErrorByStatus),
  decodeErrorMessage,
])

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const directStatus = (error as { status?: unknown }).status
  if (typeof directStatus === 'number') {
    return directStatus
  }
  const requestStatus = (error as { request?: { status?: unknown } }).request
    ?.status
  return typeof requestStatus === 'number' ? requestStatus : undefined
}

export function toSafeViewerError(error: unknown): string {
  if (typeof error === 'string' && safeViewerMessages.has(error)) {
    return error
  }
  const status = errorStatus(error)
  return status === undefined
    ? decodeErrorMessage
    : (viewerErrorByStatus[status] ?? viewerErrorByStatus[500])
}

export async function createAxialViewportRuntime(
  element: HTMLDivElement,
  imageIds: readonly string[],
  initialIndex: number,
  onIndexChange: (index: number) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<AxialViewportRuntime> {
  const { core, tools } = await initializeCornerstone()
  if (signal?.aborted) {
    throw abortError()
  }
  runtimeSequence += 1
  const suffix = runtimeSequence.toString()
  const renderingEngineId = `axial-rendering-${suffix}`
  const viewportId = `axial-viewport-${suffix}`
  const toolGroupId = `axial-tools-${suffix}`
  const renderingEngine = new core.RenderingEngine(renderingEngineId)
  let toolGroupCreated = false
  let listenersAttached = false
  let cancelled = false
  let destroyed = false
  const failedImageIds = new Set<string>()

  const handleNewImage = (event: Event) => {
    const detail = (
      event as CustomEvent<{ imageId?: string; imageIdIndex: number }>
    ).detail
    if (detail.imageId !== undefined) {
      failedImageIds.delete(detail.imageId)
    }
    if (!destroyed) {
      onIndexChange(detail.imageIdIndex)
    }
  }
  const handleImageLoadError = (event: Event) => {
    const detail = (
      event as CustomEvent<{ error?: unknown; imageId?: string }>
    ).detail
    if (
      !cancelled &&
      detail?.imageId !== undefined &&
      imageIds.includes(detail.imageId)
    ) {
      failedImageIds.add(detail.imageId)
      onError(toSafeViewerError(detail.error))
    }
  }

  function destroyRuntime(): void {
    if (destroyed) {
      return
    }
    destroyed = true
    signal?.removeEventListener('abort', cancelAndDestroy)
    if (listenersAttached) {
      element.removeEventListener(
        core.Enums.Events.STACK_NEW_IMAGE,
        handleNewImage,
      )
      core.eventTarget.removeEventListener(
        core.Enums.Events.IMAGE_LOAD_ERROR,
        handleImageLoadError,
      )
    }
    if (toolGroupCreated) {
      tools.ToolGroupManager.destroyToolGroup(toolGroupId)
    }
    renderingEngine.destroy()
  }

  function cancelAndDestroy(): void {
    cancelled = true
    abortPendingDicomLoads(imageIds)
    destroyRuntime()
  }

  signal?.addEventListener('abort', cancelAndDestroy, { once: true })

  try {
    renderingEngine.enableElement({
      element,
      viewportId,
      type: core.Enums.ViewportType.STACK,
      defaultOptions: { background: [0, 0, 0] },
    })
    const viewport = renderingEngine.getViewport<
      import('@cornerstonejs/core').StackViewport
    >(viewportId)

    const toolClasses = [
      tools.StackScrollTool,
      tools.WindowLevelTool,
      tools.PanTool,
      tools.ZoomTool,
    ]
    for (const toolClass of toolClasses) {
      if (!registeredTools.has(toolClass.toolName)) {
        tools.addTool(toolClass)
        registeredTools.add(toolClass.toolName)
      }
    }
    const createdToolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId)
    if (createdToolGroup === undefined) {
      throw new Error('Unable to create tool group')
    }
    const toolGroup = createdToolGroup
    toolGroupCreated = true
    for (const toolClass of toolClasses) {
      toolGroup.addTool(toolClass.toolName)
    }
    toolGroup.setToolActive(tools.StackScrollTool.toolName, {
      bindings: [{ mouseButton: tools.Enums.MouseBindings.Wheel }],
    })
    toolGroup.addViewport(viewportId, renderingEngineId)

    const displayToolNames = {
      pan: tools.PanTool.toolName,
      windowLevel: tools.WindowLevelTool.toolName,
      zoom: tools.ZoomTool.toolName,
    } satisfies Record<import('../model/axialViewer').ViewerTool, string>

    function activateTool(tool: import('../model/axialViewer').ViewerTool) {
      for (const toolName of Object.values(displayToolNames)) {
        toolGroup.setToolPassive(toolName)
      }
      toolGroup.setToolActive(displayToolNames[tool], {
        bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
      })
    }
    activateTool('windowLevel')

    element.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, handleNewImage)
    core.eventTarget.addEventListener(
      core.Enums.Events.IMAGE_LOAD_ERROR,
      handleImageLoadError,
    )
    listenersAttached = true
    await viewport.setStack([...imageIds], initialIndex)
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    onIndexChange(initialIndex)
    viewport.render()

    async function setIndex(index: number): Promise<void> {
      const bounded = Math.max(0, Math.min(imageIds.length - 1, index))
      try {
        await viewport.setImageIdIndex(bounded)
      } catch (error) {
        onError(toSafeViewerError(error))
      }
    }

    async function retryCurrent(): Promise<void> {
      const currentIndex = viewport.getCurrentImageIdIndex()
      const currentImageId = imageIds[currentIndex]
      try {
        if (
          failedImageIds.has(currentImageId) &&
          core.cache.getImageLoadObject(currentImageId) !== undefined
        ) {
          core.cache.removeImageLoadObject(currentImageId, { force: true })
        }
        await viewport.setStack([...imageIds], currentIndex)
        onIndexChange(currentIndex)
        viewport.render()
      } catch (error) {
        onError(toSafeViewerError(error))
      }
    }

    return {
      activateTool,
      destroy: cancelAndDestroy,
      next: () => setIndex(viewport.getCurrentImageIdIndex() + 1),
      previous: () => setIndex(viewport.getCurrentImageIdIndex() - 1),
      reset: async () => {
        await setIndex(initialIndex)
        viewport.resetProperties()
        viewport.resetCamera()
        viewport.render()
      },
      resize: () => renderingEngine.resize(),
      retry: retryCurrent,
    }
  } catch (error) {
    destroyRuntime()
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    const message = toSafeViewerError(error)
    onError(message)
    throw new Error(message)
  }
}
