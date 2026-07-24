import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import { CALIBRATION_UNAVAILABLE_MESSAGE } from '../model/viewerAnnotation'
import { MeasurementToolbar } from './MeasurementToolbar'


it('renders all annotation tools, active state, count, and actions', async () => {
  const user = userEvent.setup()
  const onActivateTool = vi.fn()
  const onRequestClear = vi.fn()
  render(
    <MeasurementToolbar
      activeTool="length"
      annotationCount={3}
      calibration={{ available: true, reason: null }}
      clearButtonRef={createRef()}
      disabled={false}
      onActivateTool={onActivateTool}
      onRequestClear={onRequestClear}
    />,
  )

  for (const label of ['长度', '角度', '矩形 ROI', '箭头标注', '删除单项']) {
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
  }
  expect(screen.getByRole('button', { name: '长度' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByText('当前共有 3 项测量与标注')).toHaveAttribute(
    'aria-live',
    'polite',
  )

  await user.click(screen.getByRole('button', { name: '角度' }))
  await user.click(screen.getByRole('button', { name: '全部清空' }))
  expect(onActivateTool).toHaveBeenCalledWith('angle')
  expect(onRequestClear).toHaveBeenCalledOnce()
})
it('disables geometry without calibration while preserving arrow annotation', () => {
  render(
    <MeasurementToolbar
      activeTool="windowLevel"
      annotationCount={1}
      calibration={{
        available: false,
        reason: CALIBRATION_UNAVAILABLE_MESSAGE,
      }}
      clearButtonRef={createRef()}
      disabled={false}
      onActivateTool={vi.fn()}
      onRequestClear={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: '长度' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '角度' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '矩形 ROI' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '箭头标注' })).toBeEnabled()
  expect(screen.getByText(CALIBRATION_UNAVAILABLE_MESSAGE)).toBeVisible()
})

it('disables erase and clear at zero count and every action while unavailable', () => {
  const props = {
    activeTool: 'windowLevel',
    annotationCount: 0,
    calibration: { available: true, reason: null },
    clearButtonRef: createRef<HTMLButtonElement>(),
    disabled: false,
    onActivateTool: vi.fn(),
    onRequestClear: vi.fn(),
  } as const
  const { rerender } = render(<MeasurementToolbar {...props} />)

  expect(screen.getByRole('button', { name: '删除单项' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '全部清空' })).toBeDisabled()

  rerender(<MeasurementToolbar {...props} disabled />)
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
  }
})
