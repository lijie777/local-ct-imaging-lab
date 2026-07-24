import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { ViewerStateStatus } from './ViewerStateStatus'


it.each([
  [{ kind: 'loading' } as const, '正在读取上次查看状态…'],
  [{ kind: 'restored' } as const, '已恢复上次查看状态'],
  [{ kind: 'saving' } as const, '正在保存查看状态…'],
  [{ kind: 'saved' } as const, '查看状态已保存'],
  [{ kind: 'cleared' } as const, '已恢复默认状态并清除保存'],
  [{ kind: 'partial', skipped: 2 } as const, '已恢复查看状态，2 项标注因影像不匹配而跳过'],
])('announces %j without clinical wording', (status, message) => {
  render(<ViewerStateStatus status={status} />)

  const region = screen.getByRole('status', { name: '查看器状态' })
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(region).toHaveTextContent(message)
  expect(region).not.toHaveTextContent(/临床|诊断|治疗/)
})

it('offers retry and clear for load errors and moves focus after the chosen action completes', async () => {
  const user = userEvent.setup()
  const onClear = vi.fn()
  const onRetry = vi.fn()
  const { rerender } = render(
    <ViewerStateStatus
      onClear={onClear}
      onRetry={onRetry}
      status={{ kind: 'error', operation: 'load' }}
    />,
  )

  expect(screen.getByRole('status', { name: '查看器状态' })).toHaveTextContent(
    '无法读取已保存状态，已使用默认状态',
  )
  await user.click(screen.getByRole('button', { name: '重试读取状态' }))
  expect(onRetry).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '清除已保存状态' }))
  expect(onClear).toHaveBeenCalledOnce()

  rerender(<ViewerStateStatus status={{ kind: 'cleared' }} />)
  expect(screen.getByRole('status', { name: '查看器状态' })).toHaveFocus()
})

it.each([
  ['save' as const, '状态保存失败，当前调整仅在本次会话有效', '重试保存状态'],
  ['clear' as const, '清除保存失败，当前仍使用默认状态', '重试清除保存'],
])('shows a focused retry path for %s errors', async (operation, message, label) => {
  const user = userEvent.setup()
  const onRetry = vi.fn()
  render(
    <ViewerStateStatus
      onRetry={onRetry}
      status={{ kind: 'error', operation }}
    />,
  )

  expect(screen.getByRole('status', { name: '查看器状态' })).toHaveTextContent(message)
  await user.click(screen.getByRole('button', { name: label }))
  expect(onRetry).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: label })).toHaveFocus()
  expect(screen.queryByRole('button', { name: '清除已保存状态' })).not.toBeInTheDocument()
})

it('renders nothing when there is no persistence status to announce', () => {
  const { container } = render(<ViewerStateStatus status={null} />)

  expect(container).toBeEmptyDOMElement()
})
