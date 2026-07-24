import type {
  MprTool,
  MprViewportId,
  MprViewportOrientation,
  Point3,
} from '../model/mprViewer'
import type { AnnotationRestoreResult } from '../../viewer-state/core/annotationPersistence'
import type {
  MprViewerState,
  PersistedViewerAnnotation,
} from '../../viewer-state/model/viewerState'

export interface MprRuntimeElements {
  axial: HTMLDivElement
  coronal: HTMLDivElement
  sagittal: HTMLDivElement
}

export interface MprRuntimeProgress {
  loaded: number
  processed: number
  total: number
}

export interface MprRuntimeCallbacks {
  onActiveViewport(viewport: MprViewportId): void
  onError(message: string): void
  onOrientation?(
    viewport: MprViewportId,
    orientation: MprViewportOrientation,
  ): void
  onPosition(viewport: MprViewportId, point: Point3): void
  onProgress(progress: MprRuntimeProgress): void
  onReady(): void
  onStateChange?(): void
}

export interface MprRuntime {
  activateTool(tool: MprTool): void
  applyState(
    state: MprViewerState,
    annotations: readonly PersistedViewerAnnotation[],
  ): Promise<AnnotationRestoreResult>
  captureState(): {
    state: MprViewerState
    annotations: PersistedViewerAnnotation[]
  }
  clearAnnotations(): void
  destroy(): void
  reset(): void
  resize(): void
  setCrosshairsVisible(visible: boolean): void
}
