import type {
  MprTool,
  MprViewportId,
  MprViewportOrientation,
  Point3,
} from '../model/mprViewer'

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
}

export interface MprRuntime {
  activateTool(tool: MprTool): void
  destroy(): void
  reset(): void
  resize(): void
  setCrosshairsVisible(visible: boolean): void
}
