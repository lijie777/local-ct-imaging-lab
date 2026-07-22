import type { MprTool, MprViewportId } from '../model/mprViewer'


interface MprToolbarProps {
  activeTool: MprTool
  activeViewport: MprViewportId
  crosshairsVisible: boolean
  disabled: boolean
  onActivateTool: (tool: MprTool) => void
  onReset: () => void
  onToggleCrosshairs: () => void
}

const TOOLS: Array<{ id: MprTool; label: string }> = [
  { id: 'crosshairs', label: '十字定位' },
  { id: 'windowLevel', label: '窗宽窗位' },
  { id: 'pan', label: '平移' },
  { id: 'zoom', label: '缩放' },
]

const VIEWPORT_LABELS: Record<MprViewportId, string> = {
  axial: '轴位',
  coronal: '冠状位',
  sagittal: '矢状位',
}

export function MprToolbar({
  activeTool,
  activeViewport,
  crosshairsVisible,
  disabled,
  onActivateTool,
  onReset,
  onToggleCrosshairs,
}: MprToolbarProps) {
  return (
    <div aria-label="三视图工具" className="mpr-toolbar" role="toolbar">
      <div className="mpr-toolbar__tools">
        {TOOLS.map(({ id, label }) => (
          <button
            aria-pressed={activeTool === id}
            className="button button--secondary"
            disabled={disabled}
            key={id}
            onClick={() => onActivateTool(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <span aria-live="polite" className="mpr-toolbar__current">
        {`当前视图：${VIEWPORT_LABELS[activeViewport]}`}
      </span>
      <div className="mpr-toolbar__actions">
        <button
          className="button button--secondary"
          disabled={disabled}
          onClick={onToggleCrosshairs}
          type="button"
        >
          {crosshairsVisible ? '隐藏十字定位线' : '显示十字定位线'}
        </button>
        <button
          className="button button--secondary"
          disabled={disabled}
          onClick={onReset}
          type="button"
        >
          重置三视图
        </button>
      </div>
    </div>
  )
}
