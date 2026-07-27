import type {
  Advanced3dMode,
  StandardViewDirection,
  VolumePreset,
} from '../model/advanced3dViewer'


interface Advanced3dToolbarProps {
  busy: boolean
  direction: StandardViewDirection | null
  mipThickness: number
  mipThicknessRange: readonly [number, number]
  mode: Advanced3dMode
  onDirectionChange: (direction: StandardViewDirection) => void
  onApplySurfaceThreshold: () => void
  onMipThicknessChange: (thicknessMm: number) => void
  onModeChange: (mode: Advanced3dMode) => void
  onPresetChange: (preset: VolumePreset) => void
  onReset: () => void
  onSurfaceThresholdChange: (thresholdHu: number) => void
  preset: VolumePreset
  surfaceRange: readonly [number, number] | null
  surfaceStride: number
  surfaceThreshold: number
}

const MODES: Array<{ id: Advanced3dMode; label: string }> = [
  { id: 'volume', label: '体绘制' },
  { id: 'mip', label: 'MIP' },
  { id: 'surface', label: '表面重建' },
]

const VOLUME_PRESETS: Array<{ id: VolumePreset; label: string }> = [
  { id: 'CT-Bone', label: '骨' },
  { id: 'CT-Soft-Tissue', label: '软组织' },
  { id: 'CT-Lung', label: '肺' },
]

const MIP_DIRECTIONS: Array<{
  id: StandardViewDirection
  label: string
}> = [
  { id: 'anterior', label: '前方' },
  { id: 'posterior', label: '后方' },
  { id: 'left', label: '左侧' },
  { id: 'right', label: '右侧' },
  { id: 'superior', label: '头侧' },
  { id: 'inferior', label: '足侧' },
]

function clampMipThickness(
  value: number,
  [minimum, maximum]: readonly [number, number],
): number | null {
  if (Number.isNaN(value)) {
    return null
  }
  return Math.min(maximum, Math.max(minimum, value))
}

function clampSurfaceThreshold(
  value: number,
  [minimum, maximum]: readonly [number, number],
): number | null {
  if (Number.isNaN(value)) {
    return null
  }
  return Math.min(maximum, Math.max(minimum, value))
}

export function Advanced3dToolbar({
  busy,
  direction,
  mipThickness,
  mipThicknessRange,
  mode,
  onApplySurfaceThreshold,
  onDirectionChange,
  onMipThicknessChange,
  onModeChange,
  onPresetChange,
  onReset,
  onSurfaceThresholdChange,
  preset,
  surfaceRange,
  surfaceStride,
  surfaceThreshold,
}: Advanced3dToolbarProps) {
  return (
    <div aria-label="高级 3D 工具" className="advanced-3d-toolbar" role="toolbar">
      <div
        aria-label="高级 3D 模式"
        className="advanced-3d-toolbar__group"
        role="group"
      >
        {MODES.map(({ id, label }) => (
          <button
            aria-pressed={mode === id}
            className="button button--secondary"
            disabled={busy || (id === 'surface' && surfaceRange === null)}
            key={id}
            onClick={() => onModeChange(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {!busy && surfaceRange === null ? (
        <p role="status">当前 CT 无法提供有效 HU 范围，表面重建不可用</p>
      ) : null}

      {mode === 'volume' ? (
        <div
          aria-label="体绘制预设"
          className="advanced-3d-toolbar__group"
          role="group"
        >
          {VOLUME_PRESETS.map(({ id, label }) => (
            <button
              aria-pressed={preset === id}
              className="button button--secondary"
              disabled={busy}
              key={id}
              onClick={() => onPresetChange(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'mip' ? (
        <>
          <div
            aria-label="MIP 投影方向"
            className="advanced-3d-toolbar__group"
            role="group"
          >
            {MIP_DIRECTIONS.map(({ id, label }) => (
              <button
                aria-pressed={direction === id}
                className="button button--secondary"
                disabled={busy}
                key={id}
                onClick={() => onDirectionChange(id)}
                type="button"
              >
                {label}
              </button>
            ))}
            <p>
              {direction === null
                ? '自由视角'
                : `当前方向：${MIP_DIRECTIONS.find(({ id }) => id === direction)?.label}`}
            </p>
          </div>

          <div className="advanced-3d-toolbar__group">
            <span>MIP 投影厚度</span>
            <input
              aria-label="MIP 投影厚度"
              disabled={busy}
              max={mipThicknessRange[1]}
              min={mipThicknessRange[0]}
              onChange={(event) => {
                const value = clampMipThickness(
                  event.currentTarget.valueAsNumber,
                  mipThicknessRange,
                )
                if (value !== null) {
                  onMipThicknessChange(value)
                }
              }}
              step="0.1"
              type="range"
              value={mipThickness}
            />
            <input
              aria-label="MIP 投影厚度"
              disabled={busy}
              max={mipThicknessRange[1]}
              min={mipThicknessRange[0]}
              onChange={(event) => {
                const value = clampMipThickness(
                  event.currentTarget.valueAsNumber,
                  mipThicknessRange,
                )
                if (value !== null) {
                  onMipThicknessChange(value)
                }
              }}
              step="any"
              type="number"
              value={mipThickness}
            />
            <span>mm</span>
            <span>{`最小 ${mipThicknessRange[0]} mm`}</span>
            <span>{`最大 ${mipThicknessRange[1]} mm`}</span>
            <span>完整体数据</span>
          </div>
        </>
      ) : null}

      {mode === 'surface' && surfaceRange !== null ? (
        <div className="advanced-3d-toolbar__group">
          <span>表面阈值</span>
          <input
            aria-label="表面阈值"
            disabled={busy}
            max={surfaceRange[1]}
            min={surfaceRange[0]}
            onChange={(event) => {
              const value = clampSurfaceThreshold(
                event.currentTarget.valueAsNumber,
                surfaceRange,
              )
              if (value !== null) {
                onSurfaceThresholdChange(value)
              }
            }}
            step="1"
            type="range"
            value={surfaceThreshold}
          />
          <input
            aria-label="表面阈值"
            disabled={busy}
            max={surfaceRange[1]}
            min={surfaceRange[0]}
            onChange={(event) => {
              const value = clampSurfaceThreshold(
                event.currentTarget.valueAsNumber,
                surfaceRange,
              )
              if (value !== null) {
                onSurfaceThresholdChange(value)
              }
            }}
            step="1"
            type="number"
            value={surfaceThreshold}
          />
          <span>HU</span>
          <span>{`最小 ${surfaceRange[0]} HU`}</span>
          <span>{`最大 ${surfaceRange[1]} HU`}</span>
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onApplySurfaceThreshold}
            type="button"
          >
            应用阈值
          </button>
          {surfaceStride > 1 ? (
            <p>{`为保证浏览器响应，已降低表面采样密度（步长 ${surfaceStride}）`}</p>
          ) : null}
        </div>
      ) : null}

      <button
        className="button button--secondary"
        disabled={busy}
        onClick={onReset}
        type="button"
      >
        重置高级 3D
      </button>
    </div>
  )
}
