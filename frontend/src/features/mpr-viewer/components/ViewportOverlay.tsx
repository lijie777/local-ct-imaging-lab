import type {
  MprViewportOrientation,
  Point3,
} from '../model/mprViewer'


interface ViewportOverlayProps {
  active: boolean
  label: string
  orientation: MprViewportOrientation
  position: Point3
}

export function ViewportOverlay({
  active,
  label,
  orientation,
  position,
}: ViewportOverlayProps) {
  return (
    <div aria-label={`${label}视图信息`} className="mpr-overlay">
      <div className="mpr-overlay__summary">
        <strong>{label}</strong>
        <span>{active ? '当前活动视图' : '非活动视图'}</span>
      </div>
      <span className="mpr-overlay__position">
        {`位置：${position.map((value) => value.toFixed(1)).join(', ')} mm`}
      </span>
      <span className="mpr-overlay__orientation mpr-overlay__orientation--top">
        {orientation.top}
      </span>
      <span className="mpr-overlay__orientation mpr-overlay__orientation--right">
        {orientation.right}
      </span>
      <span className="mpr-overlay__orientation mpr-overlay__orientation--bottom">
        {orientation.bottom}
      </span>
      <span className="mpr-overlay__orientation mpr-overlay__orientation--left">
        {orientation.left}
      </span>
    </div>
  )
}
