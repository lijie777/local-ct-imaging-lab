import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { MprToolbar } from './MprToolbar'


it('exposes four mutually exclusive primary tools and the active viewport text', async () => {
  const onActivateTool = vi.fn()
  const user = userEvent.setup()
  render(
    <MprToolbar
      activeTool="crosshairs"
      activeViewport="coronal"
      crosshairsVisible
      disabled={false}
      onActivateTool={onActivateTool}
      onReset={vi.fn()}
      onToggleCrosshairs={vi.fn()}
    />,
  )

  expect(screen.getByText('当前视图：冠状位')).toBeVisible()
  expect(screen.getByRole('button', { name: '十字定位' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '窗宽窗位' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '平移' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '缩放' })).toHaveAttribute('aria-pressed', 'false')

  await user.click(screen.getByRole('button', { name: '平移' }))
  expect(onActivateTool).toHaveBeenCalledWith('pan')
})

it('exposes crosshairs visibility, reset, and disabled control states', async () => {
  const onToggleCrosshairs = vi.fn()
  const onReset = vi.fn()
  const user = userEvent.setup()
  const { rerender } = render(
    <MprToolbar
      activeTool="windowLevel"
      activeViewport="axial"
      crosshairsVisible
      disabled={false}
      onActivateTool={vi.fn()}
      onReset={onReset}
      onToggleCrosshairs={onToggleCrosshairs}
    />,
  )

  await user.click(screen.getByRole('button', { name: '隐藏十字定位线' }))
  await user.click(screen.getByRole('button', { name: '重置三视图' }))
  expect(onToggleCrosshairs).toHaveBeenCalledOnce()
  expect(onReset).toHaveBeenCalledOnce()

  rerender(
    <MprToolbar
      activeTool="windowLevel"
      activeViewport="axial"
      crosshairsVisible={false}
      disabled
      onActivateTool={vi.fn()}
      onReset={onReset}
      onToggleCrosshairs={onToggleCrosshairs}
    />,
  )
  expect(screen.getByRole('button', { name: '显示十字定位线' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '十字定位' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '窗宽窗位' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '平移' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '缩放' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '重置三视图' })).toBeDisabled()
})
