import {
  ANNOTATION_TOOL_NAMES,
  installViewerAnnotationTools,
  type ViewerAnnotationController,
} from '../../viewer-annotations/core/annotationTools'
import {
  GEOMETRY_MEASUREMENT_TOOLS,
  isViewerAnnotationTool,
  type ViewerAnnotationCallbacks,
} from '../../viewer-annotations/model/viewerAnnotation'
import type { AxialTool, ViewerTool } from '../model/axialViewer'
import type {
  AnnotationRestoreResult,
} from '../../viewer-state/core/annotationPersistence'
import type {
  AxialViewerState,
  PersistedViewerAnnotation,
} from '../../viewer-state/model/viewerState'


export interface CornerstoneModules {
  core: typeof import('@cornerstonejs/core')
  loader: typeof import('@cornerstonejs/dicom-image-loader')
  tools: typeof import('@cornerstonejs/tools')
}

export interface AxialViewportRuntime {
  activateTool(tool: AxialTool): void
  applyState(
    state: AxialViewerState,
    annotations: readonly PersistedViewerAnnotation[],
  ): Promise<AnnotationRestoreResult>
  captureState(): {
    state: AxialViewerState
    annotations: PersistedViewerAnnotation[]
  }
  clearAnnotations(): void
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

const NOOP_ANNOTATION_CALLBACKS: ViewerAnnotationCallbacks = {
  onAnnotationCountChange: () => undefined,
  onCalibrationChange: () => undefined,
  onTextRequest: () => undefined,
}


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
  annotationCallbacks: ViewerAnnotationCallbacks = NOOP_ANNOTATION_CALLBACKS,
  onStateChange: () => void = () => undefined,
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
  let annotationController: ViewerAnnotationController | null = null
  let activeTool: AxialTool = 'windowLevel'
  let calibrationAvailable = false
  let restoring = false
  const failedImageIds = new Set<string>()

  function notifyStateChange(): void {
    if (!destroyed && !restoring) {
      onStateChange()
    }
  }

  const handleNewImage = (event: Event) => {
    const detail = (
      event as CustomEvent<{ imageId?: string; imageIdIndex: number }>
    ).detail
    if (detail.imageId !== undefined) {
      failedImageIds.delete(detail.imageId)
    }
    if (!destroyed) {
      onIndexChange(detail.imageIdIndex)
      notifyStateChange()
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
      element.removeEventListener(
        core.Enums.Events.CAMERA_MODIFIED,
        notifyStateChange,
      )
      element.removeEventListener(
        core.Enums.Events.VOI_MODIFIED,
        notifyStateChange,
      )
      core.eventTarget.removeEventListener(
        core.Enums.Events.IMAGE_LOAD_ERROR,
        handleImageLoadError,
      )
    }
    annotationController?.destroy()
    annotationController = null
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
    } satisfies Record<ViewerTool, string>

    function activateTool(tool: AxialTool, notify = true) {
      for (const toolName of Object.values(displayToolNames)) {
        toolGroup.setToolPassive(toolName)
      }
      if (isViewerAnnotationTool(tool)) {
        annotationController?.activate(tool)
        activeTool = tool
        if (notify) {
          notifyStateChange()
        }
        return
      }
      if (annotationController !== null) {
        for (const toolName of Object.values(ANNOTATION_TOOL_NAMES)) {
          toolGroup.setToolPassive(toolName, { removeAllBindings: true })
        }
      }
      toolGroup.setToolActive(displayToolNames[tool], {
        bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
      })
      activeTool = tool
      if (notify) {
        notifyStateChange()
      }
    }
    activateTool('windowLevel', false)

    element.addEventListener(core.Enums.Events.STACK_NEW_IMAGE, handleNewImage)
    element.addEventListener(
      core.Enums.Events.CAMERA_MODIFIED,
      notifyStateChange,
    )
    element.addEventListener(core.Enums.Events.VOI_MODIFIED, notifyStateChange)
    core.eventTarget.addEventListener(
      core.Enums.Events.IMAGE_LOAD_ERROR,
      handleImageLoadError,
    )
    listenersAttached = true
    await viewport.setStack([...imageIds], initialIndex)
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    await Promise.allSettled(core.imageLoader.loadAndCacheImages([...imageIds]))
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    annotationController = installViewerAnnotationTools({
      callbacks: {
        ...annotationCallbacks,
        onAnnotationsChange: () => {
          annotationCallbacks.onAnnotationsChange?.()
          notifyStateChange()
        },
        onCalibrationChange: (value) => {
          calibrationAvailable = value.available
          annotationCallbacks.onCalibrationChange(value)
        },
      },
      core,
      elements: [element],
      imageIds,
      toolGroup,
      tools,
    })
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

    function finite(value: unknown): number | null {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function point2(value: unknown): [number, number] | null {
      return Array.isArray(value) && value.length === 2 &&
        value.every((item) => finite(item) !== null)
        ? [value[0] as number, value[1] as number]
        : null
    }

    function captureState(): {
      state: AxialViewerState
      annotations: PersistedViewerAnnotation[]
    } {
      const presentation = viewport.getViewPresentation()
      const properties = viewport.getProperties()
      const lower = finite(properties.voiRange?.lower)
      const upper = finite(properties.voiRange?.upper)
      const zoom = finite(presentation.zoom)
      return {
        state: {
          image_index: viewport.getCurrentImageIdIndex(),
          active_tool: activeTool,
          presentation: {
            zoom: zoom !== null && zoom > 0 ? zoom : null,
            pan: point2(presentation.pan),
            rotation: finite(presentation.rotation),
            flip_horizontal: typeof presentation.flipHorizontal === 'boolean'
              ? presentation.flipHorizontal
              : null,
            flip_vertical: typeof presentation.flipVertical === 'boolean'
              ? presentation.flipVertical
              : null,
          },
          voi: lower !== null && upper !== null && lower < upper
            ? {
                lower,
                upper,
                invert: properties.invert === true,
              }
            : null,
        },
        annotations: annotationController?.capture({ axial: element }) ?? [],
      }
    }

    async function applyState(
      state: AxialViewerState,
      annotations: readonly PersistedViewerAnnotation[],
    ): Promise<AnnotationRestoreResult> {
      restoring = true
      try {
        const bounded = Math.max(0, Math.min(imageIds.length - 1, state.image_index))
        try {
          await viewport.setImageIdIndex(bounded)
          onIndexChange(bounded)
        } catch (error) {
          onError(toSafeViewerError(error))
        }
        if (state.presentation !== null) {
          viewport.setViewPresentation({
            ...(state.presentation.zoom === null || state.presentation.zoom === undefined
              ? {}
              : { zoom: state.presentation.zoom }),
            ...(state.presentation.pan === null || state.presentation.pan === undefined
              ? {}
              : { pan: [...state.presentation.pan] as [number, number] }),
            ...(state.presentation.rotation === null || state.presentation.rotation === undefined
              ? {}
              : { rotation: state.presentation.rotation }),
            ...(state.presentation.flip_horizontal === null || state.presentation.flip_horizontal === undefined
              ? {}
              : { flipHorizontal: state.presentation.flip_horizontal }),
            ...(state.presentation.flip_vertical === null || state.presentation.flip_vertical === undefined
              ? {}
              : { flipVertical: state.presentation.flip_vertical }),
          })
        }
        if (state.voi !== null) {
          viewport.setProperties({
            voiRange: { lower: state.voi.lower, upper: state.voi.upper },
            invert: state.voi.invert,
          })
        }
        const result = annotationController?.restore(
          { axial: viewport },
          annotations,
        ) ?? { restored: 0, skipped: annotations.length }
        const geometryTool = (
          GEOMETRY_MEASUREMENT_TOOLS as readonly string[]
        ).includes(state.active_tool)
        activateTool(
          geometryTool && !calibrationAvailable
            ? 'windowLevel'
            : state.active_tool,
          false,
        )
        viewport.render()
        return result
      } finally {
        restoring = false
      }
    }

    return {
      activateTool,
      applyState,
      captureState,
      clearAnnotations: () => annotationController?.clearAnnotations(),
      destroy: cancelAndDestroy,
      next: () => setIndex(viewport.getCurrentImageIdIndex() + 1),
      previous: () => setIndex(viewport.getCurrentImageIdIndex() - 1),
      reset: async () => {
        restoring = true
        try {
          activateTool('windowLevel', false)
          await setIndex(initialIndex)
          viewport.resetProperties()
          viewport.resetCamera()
          viewport.render()
        } finally {
          restoring = false
        }
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
