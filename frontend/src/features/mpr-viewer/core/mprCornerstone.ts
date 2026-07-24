import {
  abortPendingDicomLoads,
  initializeCornerstone,
} from '../../axial-viewer/core/cornerstone'
import {
  ANNOTATION_TOOL_NAMES,
  installViewerAnnotationTools,
  type ViewerAnnotationController,
} from '../../viewer-annotations/core/annotationTools'
import {
  GEOMETRY_MEASUREMENT_TOOLS,
  isViewerAnnotationTool,
  type ViewerAnnotationCallbacks,
  type ViewerAnnotationTool,
} from '../../viewer-annotations/model/viewerAnnotation'
import type {
  MprTool,
  MprViewportId,
  MprViewportOrientation,
} from '../model/mprViewer'
import {
  abortError,
  runtimeErrorMessage,
  safeCall,
  toSafeRuntimeError,
} from './mprRuntimeErrors'
import {
  intersectCameraPlanes,
  voiRange,
  type VoiRange,
} from './mprRuntimeGeometry'
import type {
  MprRuntime,
  MprRuntimeCallbacks,
  MprRuntimeElements,
} from './mprRuntimeTypes'
import type { AnnotationRestoreResult } from '../../viewer-state/core/annotationPersistence'
import type {
  MprViewerState,
  PersistedViewerAnnotation,
  ViewPresentationState,
  ViewportDisplayState,
} from '../../viewer-state/model/viewerState'

export type {
  MprRuntime,
  MprRuntimeCallbacks,
  MprRuntimeElements,
  MprRuntimeProgress,
} from './mprRuntimeTypes'

interface VolumeLoadResult {
  framesLoaded?: number
  framesProcessed?: number
  totalNumFrames?: number
}

interface StreamingVolume {
  cancelLoading?(): void
  clearLoadCallbacks?(): void
  load(callback: (result: VolumeLoadResult) => void): void
}

const VIEWPORTS = ['axial', 'coronal', 'sagittal'] as const
const RENDERING_ENGINE_PREFIX = 'mpr-rendering-'
const VIEWPORT_PREFIX = 'mpr-viewport-'
const TOOL_GROUP_PREFIX = 'mpr-tools-'
const VOLUME_PREFIX = 'cornerstoneStreamingImageVolume:mpr-'
const partialLoadMessage = '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器'
const registeredTools = new Set<string>()
let runtimeSequence = 0

const NOOP_ANNOTATION_CALLBACKS: ViewerAnnotationCallbacks = {
  onAnnotationCountChange: () => undefined,
  onCalibrationChange: () => undefined,
  onTextRequest: () => undefined,
}

const DEFAULT_ORIENTATIONS: Record<MprViewportId, MprViewportOrientation> = {
  axial: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
  coronal: { top: 'S', right: 'L', bottom: 'I', left: 'R' },
  sagittal: { top: 'S', right: 'P', bottom: 'I', left: 'A' },
}

function hasNonZeroSize(element: HTMLDivElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0
}

export async function createMprRuntime(
  elements: MprRuntimeElements,
  imageIds: readonly string[],
  callbacks: MprRuntimeCallbacks,
  signal?: AbortSignal,
  annotationCallbacks: ViewerAnnotationCallbacks = NOOP_ANNOTATION_CALLBACKS,
): Promise<MprRuntime> {
  const { core, tools } = await initializeCornerstone()
  if (signal?.aborted) {
    throw abortError()
  }
  if (imageIds.length === 0 || VIEWPORTS.some((id) => !hasNonZeroSize(elements[id]))) {
    throw new Error(runtimeErrorMessage)
  }

  runtimeSequence += 1
  const suffix = `${runtimeSequence}`
  const renderingEngineId = `${RENDERING_ENGINE_PREFIX}${suffix}`
  const volumeId = `${VOLUME_PREFIX}${suffix}`
  const toolGroupId = `${TOOL_GROUP_PREFIX}${suffix}`
  const viewportIds = Object.fromEntries(
    VIEWPORTS.map((id) => [id, `${VIEWPORT_PREFIX}${id}-${suffix}`]),
  ) as Record<MprViewportId, string>
  const renderingEngine = new core.RenderingEngine(renderingEngineId)
  let volume: StreamingVolume | null = null
  let toolGroupCreated = false
  let destroyed = false
  let cancelled = false
  let loadSettled = false
  let activeTool: MprTool = 'crosshairs'
  let activeViewport: MprViewportId = 'axial'
  let crosshairsVisible = true
  let calibrationAvailable = false
  let restoring = false
  let failureMessage: string | null = null
  let syncingVoi = false
  let annotationController: ViewerAnnotationController | null = null
  const elementListeners: Array<{
    capture?: boolean
    element: HTMLDivElement
    listener: EventListener
    type: string
  }> = []
  const runtimeEventListeners: Array<{
    listener: EventListener
    type: string
  }> = []

  function destroyRuntime(): void {
    if (destroyed) {
      return
    }
    destroyed = true
    signal?.removeEventListener('abort', cancelAndDestroy)
    for (const { capture, element, listener, type } of elementListeners) {
      safeCall(() => element.removeEventListener(type, listener, capture))
    }
    for (const { listener, type } of runtimeEventListeners) {
      safeCall(() => core.eventTarget.removeEventListener(type, listener))
    }
    safeCall(() => annotationController?.destroy())
    annotationController = null
    safeCall(() => abortPendingDicomLoads(imageIds))
    safeCall(() => volume?.cancelLoading?.())
    safeCall(() => volume?.clearLoadCallbacks?.())
    if (toolGroupCreated) {
      safeCall(() => {
        const group = tools.ToolGroupManager.getToolGroup(toolGroupId)
        group?.setToolDisabled(tools.CrosshairsTool.toolName)
      })
      safeCall(() => tools.ToolGroupManager.destroyToolGroup(toolGroupId))
    }
    safeCall(() => renderingEngine.destroy())
    safeCall(() => {
      if (core.cache.getVolumeLoadObject(volumeId) !== undefined) {
        core.cache.removeVolumeLoadObject(volumeId)
      }
    })
  }

  function cancelAndDestroy(): void {
    cancelled = true
    destroyRuntime()
  }

  function ensureActive(): void {
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
  }

  signal?.addEventListener('abort', cancelAndDestroy, { once: true })

  function reportRuntimeFailure(message: string): void {
    if (destroyed || failureMessage !== null) {
      return
    }
    failureMessage = message
    callbacks.onError(message)
  }

  function notifyStateChange(): void {
    if (!destroyed && !restoring) {
      callbacks.onStateChange?.()
    }
  }

  const handleImageFailure: EventListener = (event) => {
    const detail = (event as CustomEvent<{
      error?: unknown
      imageId?: unknown
    }>).detail
    const failedImageId = detail?.imageId
    const belongsToRuntime = typeof failedImageId === 'number'
      ? Number.isFinite(failedImageId)
      : typeof failedImageId === 'string' && imageIds.includes(failedImageId)
    if (belongsToRuntime) {
      reportRuntimeFailure(toSafeRuntimeError(detail?.error))
    }
  }

  const handleVolumeFailure: EventListener = (event) => {
    const detail = (event as CustomEvent<{
      error?: unknown
      volumeId?: unknown
    }>).detail
    if (detail?.volumeId === volumeId) {
      reportRuntimeFailure(toSafeRuntimeError(detail.error))
    }
  }

  for (const [type, listener] of [
    [core.Enums.Events.IMAGE_LOAD_FAILED, handleImageFailure],
    [core.Enums.Events.IMAGE_LOAD_ERROR, handleImageFailure],
    [core.Enums.Events.VOLUME_LOADED_FAILED, handleVolumeFailure],
  ] as const) {
    core.eventTarget.addEventListener(type, listener)
    runtimeEventListeners.push({ listener, type })
  }

  try {
    const orientationByViewport = {
      axial: core.Enums.OrientationAxis.AXIAL,
      coronal: core.Enums.OrientationAxis.CORONAL,
      sagittal: core.Enums.OrientationAxis.SAGITTAL,
    }
    renderingEngine.setViewports(
      VIEWPORTS.map((id) => ({
        defaultOptions: { orientation: orientationByViewport[id] },
        element: elements[id],
        type: core.Enums.ViewportType.ORTHOGRAPHIC,
        viewportId: viewportIds[id],
      })),
    )
    for (const id of VIEWPORTS) {
      elements[id].tabIndex = 0
      const preserveTabNavigation: EventListener = (event) => {
        if (event instanceof KeyboardEvent && event.key === 'Tab') {
          event.stopImmediatePropagation()
        }
      }
      elements[id].addEventListener('keydown', preserveTabNavigation, true)
      elementListeners.push({
        capture: true,
        element: elements[id],
        listener: preserveTabNavigation,
        type: 'keydown',
      })
    }

    await Promise.all(
      imageIds.map((imageId) => core.imageLoader.loadImage(imageId)),
    )
    ensureActive()
    for (const imageId of imageIds) {
      if (core.cache.getImageLoadObject(imageId) !== undefined) {
        core.cache.removeImageLoadObject(imageId, { force: true })
      }
    }
    volume = await core.volumeLoader.createAndCacheVolume(volumeId, {
      imageIds: [...imageIds],
    }) as StreamingVolume
    ensureActive()
    await core.setVolumesForViewports(
      renderingEngine,
      [{ volumeId }],
      VIEWPORTS.map((id) => viewportIds[id]),
    )
    ensureActive()
    for (const id of VIEWPORTS) {
      renderingEngine.getViewport<{ resetCamera(): void }>(viewportIds[id]).resetCamera()
    }

    const toolClasses = [
      tools.CrosshairsTool,
      tools.WindowLevelTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.StackScrollTool,
    ]
    for (const toolClass of toolClasses) {
      const globallyRegistered = typeof tools.store?.hasTool === 'function' &&
        tools.store.hasTool(toolClass.toolName)
      if (!globallyRegistered && !registeredTools.has(toolClass.toolName)) {
        tools.addTool(toolClass)
      }
      registeredTools.add(toolClass.toolName)
    }
    const createdToolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId)
    if (createdToolGroup === undefined) {
      throw new Error(runtimeErrorMessage)
    }
    const toolGroup = createdToolGroup
    toolGroupCreated = true
    for (const toolClass of toolClasses) {
      toolGroup.addTool(toolClass.toolName)
    }
    for (const id of VIEWPORTS) {
      toolGroup.addViewport(viewportIds[id], renderingEngineId)
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
      elements: VIEWPORTS.map((id) => elements[id]),
      imageIds,
      toolGroup,
      tools,
    })
    const toolNameByMprTool: Record<MprTool, string> = {
      ...ANNOTATION_TOOL_NAMES,
      crosshairs: tools.CrosshairsTool.toolName,
      pan: tools.PanTool.toolName,
      windowLevel: tools.WindowLevelTool.toolName,
      zoom: tools.ZoomTool.toolName,
    }
    const primaryTools: Array<[
      Exclude<MprTool, ViewerAnnotationTool>,
      string,
    ]> = [
      ['crosshairs', tools.CrosshairsTool.toolName],
      ['pan', tools.PanTool.toolName],
      ['windowLevel', tools.WindowLevelTool.toolName],
      ['zoom', tools.ZoomTool.toolName],
    ]

    function activatePrimaryTool(tool: MprTool, notify = true): void {
      if (destroyed) {
        return
      }
      const activeToolName = toolNameByMprTool[tool]
      if (isViewerAnnotationTool(tool)) {
        if (crosshairsVisible) {
          toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
        }
        for (const [, toolName] of primaryTools) {
          if (toolName !== tools.CrosshairsTool.toolName) {
            toolGroup.setToolPassive(toolName, { removeAllBindings: true })
          }
        }
        annotationController?.activate(tool)
        activeTool = tool
        if (notify) {
          notifyStateChange()
        }
        return
      }
      if (tool === 'crosshairs' && !crosshairsVisible) {
        toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
        crosshairsVisible = true
      }
      for (const [candidate, toolName] of primaryTools) {
        if (candidate === 'crosshairs' && candidate !== tool) {
          if (crosshairsVisible) {
            toolGroup.setToolEnabled(toolName)
          }
          continue
        }
        toolGroup.setToolPassive(toolName, { removeAllBindings: true })
      }
      for (const toolName of Object.values(ANNOTATION_TOOL_NAMES)) {
        toolGroup.setToolPassive(toolName, { removeAllBindings: true })
      }
      toolGroup.setToolActive(activeToolName, {
        bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
      })
      activeTool = tool
      if (notify) {
        notifyStateChange()
      }
    }

    function setCrosshairsVisibility(visible: boolean, notify = true): void {
      if (destroyed || visible === crosshairsVisible) {
        return
      }
      if (!visible) {
        if (activeTool === 'crosshairs') {
          activatePrimaryTool('windowLevel')
        }
        toolGroup.setToolDisabled(tools.CrosshairsTool.toolName)
        crosshairsVisible = false
        if (notify) {
          notifyStateChange()
        }
        return
      }
      toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
      crosshairsVisible = true
      if (notify) {
        notifyStateChange()
      }
    }

    toolGroup.setToolActive(tools.StackScrollTool.toolName, {
      bindings: [{ mouseButton: tools.Enums.MouseBindings.Wheel }],
    })
    activatePrimaryTool('crosshairs', false)
    const crosshairsTool = toolGroup.getToolInstance(
      tools.CrosshairsTool.toolName,
    ) as {
      resetCrosshairs?(): void
      setToolCenter?(position: [number, number, number], suppressEvents?: boolean): void
      toolCenter?: unknown
    } | undefined
    crosshairsTool?.resetCrosshairs?.()

    function emitLinkedPosition(): void {
      if (destroyed) {
        return
      }
      const cameras = VIEWPORTS.map((id) => renderingEngine.getViewport<{
        getCamera(): { focalPoint?: unknown; viewPlaneNormal?: unknown }
      }>(viewportIds[id]).getCamera())
      const position = intersectCameraPlanes(cameras)
      if (position === null) {
        return
      }
      for (const id of VIEWPORTS) {
        callbacks.onPosition(id, position)
      }
    }

    function syncVoiFrom(source: MprViewportId, event: Event): void {
      if (destroyed || syncingVoi) {
        return
      }
      const detail = (event as CustomEvent<{
        invert?: unknown
        invertStateChanged?: boolean
        range?: unknown
      }>).detail
      const range = voiRange(detail?.range)
      if (range === null) {
        return
      }
      const properties: { invert?: boolean; voiRange: VoiRange } = { voiRange: range }
      if (detail.invertStateChanged && typeof detail.invert === 'boolean') {
        properties.invert = detail.invert
      }
      syncingVoi = true
      try {
        for (const id of VIEWPORTS) {
          if (id === source) {
            continue
          }
          const viewport = renderingEngine.getViewport<{
            render(): void
            setProperties(
              properties: { invert?: boolean; voiRange: VoiRange },
              volumeId?: string,
              suppressEvents?: boolean,
            ): void
          }>(viewportIds[id])
          viewport.setProperties(properties, undefined, true)
          viewport.render()
        }
      } finally {
        syncingVoi = false
      }
    }

    for (const id of VIEWPORTS) {
      const activate = () => {
        if (!destroyed) {
          activeViewport = id
          callbacks.onActiveViewport(id)
          emitLinkedPosition()
          notifyStateChange()
        }
      }
      const updatePosition = () => {
        emitLinkedPosition()
        notifyStateChange()
      }
      for (const type of ['pointerdown', 'focusin']) {
        elements[id].addEventListener(type, activate)
        elementListeners.push({ element: elements[id], listener: activate, type })
      }
      for (const type of [
        core.Enums.Events.CAMERA_MODIFIED,
        core.Enums.Events.VOLUME_NEW_IMAGE,
      ]) {
        elements[id].addEventListener(type, updatePosition)
        elementListeners.push({ element: elements[id], listener: updatePosition, type })
      }
      const syncVoi = (event: Event) => {
        syncVoiFrom(id, event)
        notifyStateChange()
      }
      elements[id].addEventListener(core.Enums.Events.VOI_MODIFIED, syncVoi)
      elementListeners.push({
        element: elements[id],
        listener: syncVoi,
        type: core.Enums.Events.VOI_MODIFIED,
      })
      callbacks.onOrientation?.(id, DEFAULT_ORIENTATIONS[id])
    }
    emitLinkedPosition()

    volume.load((result) => {
      if (destroyed || failureMessage !== null || loadSettled) {
        return
      }
      const loaded = result.framesLoaded ?? 0
      const processed = result.framesProcessed ?? 0
      const total = result.totalNumFrames ?? imageIds.length
      callbacks.onProgress({ loaded, processed, total })
      if (processed !== total) {
        return
      }
      loadSettled = true
      if (loaded === total) {
        callbacks.onReady()
      } else {
        callbacks.onError(partialLoadMessage)
      }
    })
    renderingEngine.render()

    function resetRuntime(): void {
      if (destroyed) {
        return
      }
      restoring = true
      try {
        syncingVoi = true
        try {
          for (const id of VIEWPORTS) {
            renderingEngine.getViewport<{ resetProperties(): void }>(
              viewportIds[id],
            ).resetProperties()
          }
        } finally {
          syncingVoi = false
        }
        if (!crosshairsVisible) {
          toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
          crosshairsVisible = true
        }
        activatePrimaryTool('crosshairs', false)
        crosshairsTool?.resetCrosshairs?.()
        activeViewport = 'axial'
        callbacks.onActiveViewport('axial')
        emitLinkedPosition()
      } finally {
        restoring = false
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

    function point3(value: unknown): [number, number, number] | null {
      return Array.isArray(value) && value.length === 3 &&
        value.every((item) => finite(item) !== null)
        ? [value[0] as number, value[1] as number, value[2] as number]
        : null
    }

    function displayState(id: MprViewportId): ViewportDisplayState {
      const viewport = renderingEngine.getViewport<{
        getProperties(): {
          invert?: boolean
          voiRange?: { lower?: unknown; upper?: unknown }
        }
        getViewPresentation(): {
          flipHorizontal?: unknown
          flipVertical?: unknown
          pan?: unknown
          rotation?: unknown
          zoom?: unknown
        }
      }>(viewportIds[id])
      const presentation = viewport.getViewPresentation()
      const properties = viewport.getProperties()
      const lower = finite(properties.voiRange?.lower)
      const upper = finite(properties.voiRange?.upper)
      const zoom = finite(presentation.zoom)
      const safePresentation: ViewPresentationState = {
        zoom: zoom !== null && zoom > 0 ? zoom : null,
        pan: point2(presentation.pan),
        rotation: finite(presentation.rotation),
        flip_horizontal: typeof presentation.flipHorizontal === 'boolean'
          ? presentation.flipHorizontal
          : null,
        flip_vertical: typeof presentation.flipVertical === 'boolean'
          ? presentation.flipVertical
          : null,
      }
      return {
        presentation: safePresentation,
        voi: lower !== null && upper !== null && lower < upper
          ? { lower, upper, invert: properties.invert === true }
          : null,
      }
    }

    function captureState(): {
      state: MprViewerState
      annotations: PersistedViewerAnnotation[]
    } {
      const center = point3(crosshairsTool?.toolCenter) ?? [0, 0, 0]
      return {
        state: {
          active_viewport: activeViewport,
          active_tool: activeTool,
          crosshairs_visible: crosshairsVisible,
          crosshairs_position: center,
          viewports: {
            axial: displayState('axial'),
            coronal: displayState('coronal'),
            sagittal: displayState('sagittal'),
          },
        },
        annotations: annotationController?.capture(elements) ?? [],
      }
    }

    function applyPresentation(
      id: MprViewportId,
      state: ViewportDisplayState,
    ): void {
      const viewport = renderingEngine.getViewport<{
        setProperties(properties: {
          invert?: boolean
          voiRange: { lower: number; upper: number }
        }): void
        setViewPresentation(presentation: Record<string, unknown>): void
      }>(viewportIds[id])
      if (state.presentation !== null) {
        viewport.setViewPresentation({
          ...(state.presentation.zoom === null || state.presentation.zoom === undefined
            ? {}
            : { zoom: state.presentation.zoom }),
          ...(state.presentation.pan === null || state.presentation.pan === undefined
            ? {}
            : { pan: [...state.presentation.pan] }),
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
    }

    async function applyState(
      state: MprViewerState,
      annotations: readonly PersistedViewerAnnotation[],
    ): Promise<AnnotationRestoreResult> {
      restoring = true
      try {
        for (const id of VIEWPORTS) {
          applyPresentation(id, state.viewports[id])
        }
        crosshairsTool?.setToolCenter?.([...state.crosshairs_position], true)
        setCrosshairsVisibility(state.crosshairs_visible, false)
        const result = annotationController?.restore(
          {
            axial: renderingEngine.getViewport(viewportIds.axial),
            coronal: renderingEngine.getViewport(viewportIds.coronal),
            sagittal: renderingEngine.getViewport(viewportIds.sagittal),
          },
          annotations,
        ) ?? { restored: 0, skipped: annotations.length }
        const geometryTool = (
          GEOMETRY_MEASUREMENT_TOOLS as readonly string[]
        ).includes(state.active_tool)
        const nextTool = (
          geometryTool && !calibrationAvailable
        ) || (state.active_tool === 'crosshairs' && !state.crosshairs_visible)
          ? 'windowLevel'
          : state.active_tool
        activatePrimaryTool(nextTool, false)
        activeViewport = state.active_viewport
        callbacks.onActiveViewport(activeViewport)
        for (const id of VIEWPORTS) {
          callbacks.onPosition(id, [...state.crosshairs_position])
        }
        renderingEngine.render()
        return result
      } finally {
        restoring = false
      }
    }

    return {
      activateTool: activatePrimaryTool,
      applyState,
      captureState,
      clearAnnotations: () => annotationController?.clearAnnotations(),
      destroy: cancelAndDestroy,
      reset: resetRuntime,
      resize: () => renderingEngine.resize(),
      setCrosshairsVisible: setCrosshairsVisibility,
    }
  } catch (error) {
    const aborted = cancelled || signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    const message = failureMessage ?? toSafeRuntimeError(error)
    destroyRuntime()
    if (aborted) {
      throw abortError()
    }
    if (failureMessage === null) {
      failureMessage = message
      callbacks.onError(message)
    }
    throw new Error(message)
  }
}
