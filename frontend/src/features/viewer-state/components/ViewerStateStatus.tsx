import { useEffect, useRef } from 'react'


export type ViewerStateStatusValue =
  | { kind: 'loading' }
  | { kind: 'restored' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; operation: 'load' | 'save' | 'clear' }
  | { kind: 'partial'; skipped: number }
  | { kind: 'cleared' }

interface ViewerStateStatusProps {
  onClear?(): void
  onRetry?(): void
  status: ViewerStateStatusValue | null
}

function statusMessage(status: ViewerStateStatusValue): string {
  switch (status.kind) {
    case 'loading':
      return '正在读取上次查看状态…'
    case 'restored':
      return '已恢复上次查看状态'
    case 'saving':
      return '正在保存查看状态…'
    case 'saved':
      return '查看状态已保存'
    case 'partial':
      return `已恢复查看状态，${status.skipped} 项标注因影像不匹配而跳过`
    case 'cleared':
      return '已恢复默认状态并清除保存'
    case 'error':
      if (status.operation === 'load') {
        return '无法读取已保存状态，已使用默认状态'
      }
      if (status.operation === 'save') {
        return '状态保存失败，当前调整仅在本次会话有效'
      }
      return '清除保存失败，当前仍使用默认状态'
  }
}

function retryLabel(operation: 'load' | 'save' | 'clear'): string {
  if (operation === 'load') {
    return '重试读取状态'
  }
  if (operation === 'save') {
    return '重试保存状态'
  }
  return '重试清除保存'
}

export function ViewerStateStatus({
  onClear,
  onRetry,
  status,
}: ViewerStateStatusProps) {
  const regionRef = useRef<HTMLDivElement>(null)
  const focusAfterActionRef = useRef(false)

  useEffect(() => {
    if (status !== null && focusAfterActionRef.current) {
      focusAfterActionRef.current = false
      regionRef.current?.focus()
    }
  }, [status])

  if (status === null) {
    return null
  }

  const errorOperation = status.kind === 'error' ? status.operation : null
  const runAction = (action: (() => void) | undefined) => {
    focusAfterActionRef.current = true
    action?.()
  }

  return (
    <div
      aria-atomic="true"
      aria-label="查看器状态"
      aria-live="polite"
      className={`viewer-state-status${status.kind === 'error' ? ' viewer-state-status--error' : ''}`}
      ref={regionRef}
      role="status"
      tabIndex={-1}
    >
      <span>{statusMessage(status)}</span>
      {errorOperation === null ? null : (
        <div className="viewer-state-status__actions">
          {onRetry === undefined ? null : (
            <button
              className="button button--secondary"
              onClick={() => runAction(onRetry)}
              type="button"
            >
              {retryLabel(errorOperation)}
            </button>
          )}
          {errorOperation === 'load' && onClear !== undefined ? (
            <button
              className="button button--secondary"
              onClick={() => runAction(onClear)}
              type="button"
            >
              清除已保存状态
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
