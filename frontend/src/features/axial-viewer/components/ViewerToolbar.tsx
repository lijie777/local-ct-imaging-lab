import type { ViewerTool } from '../model/axialViewer'


interface ViewerToolbarProps {
  activeTool: ViewerTool
  currentIndex: number
  disabled?: boolean
  onNext: () => void
  onPrevious: () => void
  onReset: () => void
  onToolChange: (tool: ViewerTool) => void
  total: number
}


export function ViewerToolbar({
  activeTool,
  currentIndex,
  disabled = false,
  onNext,
  onPrevious,
  onReset,
  onToolChange,
  total,
}: ViewerToolbarProps) {
  const tools: Array<{ label: string; value: ViewerTool }> = [
    { label: '窗宽窗位', value: 'windowLevel' },
    { label: '平移', value: 'pan' },
    { label: '缩放', value: 'zoom' },
  ]

  return (
    <div aria-label="轴位查看工具" className="viewer-toolbar" role="toolbar">
      <div className="viewer-toolbar__tools">
        {tools.map((tool) => (
          <button
            aria-pressed={activeTool === tool.value}
            className="button button--secondary viewer-tool-button"
            disabled={disabled}
            key={tool.value}
            onClick={() => onToolChange(tool.value)}
            type="button"
          >
            {tool.label}
          </button>
        ))}
        <button
          className="button button--secondary"
          disabled={disabled}
          onClick={onReset}
          type="button"
        >
          重置
        </button>
      </div>
      <div className="viewer-toolbar__slices">
      <button
        className="button button--secondary"
        disabled={disabled || currentIndex <= 0}
        onClick={onPrevious}
        type="button"
      >
        上一张
      </button>
      <strong aria-live="polite" className="viewer-toolbar__count">
        {currentIndex + 1} / {total}
      </strong>
      <button
        className="button button--secondary"
        disabled={disabled || currentIndex >= total - 1}
        onClick={onNext}
        type="button"
      >
        下一张
      </button>
      </div>
    </div>
  )
}
