import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ViewerToolbar } from './ViewerToolbar'


it('shows slice count and disables navigation at stack boundaries', () => {
  const { rerender } = render(
    <ViewerToolbar
      activeTool="windowLevel"
      currentIndex={0}
      onNext={vi.fn()}
      onPrevious={vi.fn()}
      onReset={vi.fn()}
      onToolChange={vi.fn()}
      total={3}
    />,
  )

  expect(screen.getByText('1 / 3')).toBeVisible()
  expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下一张' })).toBeEnabled()

  rerender(
    <ViewerToolbar
      activeTool="windowLevel"
      currentIndex={2}
      onNext={vi.fn()}
      onPrevious={vi.fn()}
      onReset={vi.fn()}
      onToolChange={vi.fn()}
      total={3}
    />,
  )
  expect(screen.getByText('3 / 3')).toBeVisible()
  expect(screen.getByRole('button', { name: '下一张' })).toBeDisabled()
})

it('marks the active tool and emits tool changes plus reset', async () => {
  const onReset = vi.fn()
  const onToolChange = vi.fn()
  const user = (await import('@testing-library/user-event')).default.setup()
  render(
    <ViewerToolbar
      activeTool="windowLevel"
      currentIndex={1}
      onNext={vi.fn()}
      onPrevious={vi.fn()}
      onReset={onReset}
      onToolChange={onToolChange}
      total={3}
    />,
  )

  expect(screen.getByRole('button', { name: '窗宽窗位' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: '平移' }))
  await user.click(screen.getByRole('button', { name: '重置' }))

  expect(onToolChange).toHaveBeenCalledWith('pan')
  expect(onReset).toHaveBeenCalledOnce()
})

it('disables every action while the viewport runtime is unavailable', () => {
  render(
    <ViewerToolbar
      activeTool="windowLevel"
      currentIndex={1}
      disabled
      onNext={vi.fn()}
      onPrevious={vi.fn()}
      onReset={vi.fn()}
      onToolChange={vi.fn()}
      total={3}
    />,
  )

  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
  }
})
