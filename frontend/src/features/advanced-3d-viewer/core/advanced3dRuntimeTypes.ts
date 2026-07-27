import type {
  Advanced3dMode,
  StandardViewDirection,
  VolumePreset,
} from '../model/advanced3dViewer'

export interface Advanced3dRuntimeElements {
  viewport: HTMLDivElement
}

export interface Advanced3dRuntimeProgress {
  loaded: number
  processed: number
  total: number
}

export interface Advanced3dRuntimeCallbacks {
  onError(message: string): void
  onProgress(progress: Advanced3dRuntimeProgress): void
  onReady(): void
}

export type SurfaceResult =
  | { kind: 'empty'; stride: number; thresholdHu: number }
  | { kind: 'ready'; stride: number; thresholdHu: number }

export interface Advanced3dRuntime {
  destroy(): void
  getMipThicknessRange(): readonly [number, number]
  getSurfaceRange(): readonly [number, number] | null
  reset(): void
  resize(): void
  setDirection(direction: StandardViewDirection): void
  setMipThickness(thicknessMm: number): void
  setMode(mode: Advanced3dMode): Promise<SurfaceResult | void>
  setPreset(preset: VolumePreset): void
  setSurfaceThreshold(threshold: number): Promise<SurfaceResult>
}
