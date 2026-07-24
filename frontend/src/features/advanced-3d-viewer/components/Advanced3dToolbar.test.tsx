import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type {
  Advanced3dMode,
  StandardViewDirection,
} from '../model/advanced3dViewer'
import { Advanced3dToolbar } from './Advanced3dToolbar'


interface RenderToolbarOptions {
  busy?: boolean
  direction?: StandardViewDirection | null
  mipThickness?: number
  mipThicknessRange?: readonly [number, number]
  mode?: Advanced3dMode
  surfaceRange?: readonly [number, number]
  surfaceStride?: number
  surfaceThreshold?: number
}

function renderToolbar({
  busy = false,
  direction = 'anterior',
  mipThickness = 120,
  mipThicknessRange = [0.7, 180],
  mode = 'volume',
  surfaceRange = [-1000, 2000],
  surfaceStride = 1,
  surfaceThreshold = 300,
}: RenderToolbarOptions = {}) {
  const handlers = {
    onDirectionChange: vi.fn(),
    onMipThicknessChange: vi.fn(),
    onModeChange: vi.fn(),
    onPresetChange: vi.fn(),
    onReset: vi.fn(),
    onApplySurfaceThreshold: vi.fn(),
    onSurfaceThresholdChange: vi.fn(),
  }
  render(
    <Advanced3dToolbar
      busy={busy}
      direction={direction}
      mipThickness={mipThickness}
      mipThicknessRange={mipThicknessRange}
      mode={mode}
      surfaceRange={surfaceRange}
      surfaceStride={surfaceStride}
      surfaceThreshold={surfaceThreshold}
      preset="CT-Bone"
      {...handlers}
    />,
  )
  return handlers
}

it('always shows the three modes and marks the current mode as pressed', async () => {
  const handlers = renderToolbar()
  const user = userEvent.setup()

  expect(screen.getByRole('group', { name: '高级 3D 模式' })).toBeVisible()
  expect(screen.getByRole('button', { name: '体绘制' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'MIP' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.getByRole('button', { name: '表面重建' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await user.click(screen.getByRole('button', { name: 'MIP' }))
  await user.click(screen.getByRole('button', { name: '表面重建' }))
  expect(handlers.onModeChange).toHaveBeenNthCalledWith(1, 'mip')
  expect(handlers.onModeChange).toHaveBeenNthCalledWith(2, 'surface')
})

it('shows only six directions and physical thickness controls in MIP mode', async () => {
  const handlers = renderToolbar({ mode: 'mip' })
  const user = userEvent.setup()

  expect(screen.queryByRole('group', { name: '体绘制预设' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('表面阈值')).not.toBeInTheDocument()
  expect(screen.getByText('当前方向：前方')).toBeVisible()

  for (const [label, direction] of [
    ['前方', 'anterior'],
    ['后方', 'posterior'],
    ['左侧', 'left'],
    ['右侧', 'right'],
    ['头侧', 'superior'],
    ['足侧', 'inferior'],
  ] as const) {
    const button = screen.getByRole('button', { name: label })
    expect(button).toHaveAttribute(
      'aria-pressed',
      direction === 'anterior' ? 'true' : 'false',
    )
    await user.click(button)
  }
  expect(handlers.onDirectionChange.mock.calls.map(([value]) => value)).toEqual([
    'anterior',
    'posterior',
    'left',
    'right',
    'superior',
    'inferior',
  ])

  const thicknessInputs = screen.getAllByLabelText('MIP 投影厚度')
  expect(thicknessInputs).toHaveLength(2)
  expect(screen.getByRole('slider', { name: 'MIP 投影厚度' })).toHaveValue('120')
  expect(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' })).toHaveValue(120)
  expect(screen.getByText('mm')).toBeVisible()
  expect(screen.getByText('最小 0.7 mm')).toBeVisible()
  expect(screen.getByText('最大 180 mm')).toBeVisible()
  expect(screen.getByText('完整体数据')).toBeVisible()

  fireEvent.change(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' }), {
    target: { value: '999' },
  })
  expect(handlers.onMipThicknessChange).toHaveBeenLastCalledWith(180)
})

it('shows a free-view state when the MIP direction is no longer standard', () => {
  renderToolbar({ direction: null, mode: 'mip' })

  expect(screen.getByText('自由视角')).toBeVisible()
  for (const name of ['前方', '后方', '左侧', '右侧', '头侧', '足侧']) {
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
  }
})

it('keeps a non-step-aligned full-volume MIP thickness valid', () => {
  const maximum = 95.54187563576508
  renderToolbar({
    mipThickness: maximum,
    mipThicknessRange: [1, maximum],
    mode: 'mip',
  })

  expect(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' })).toBeValid()
})

it('shows the three volume presets with pressed state and a public reset', async () => {
  const handlers = renderToolbar()
  const user = userEvent.setup()

  expect(screen.getByRole('group', { name: '体绘制预设' })).toBeVisible()
  expect(screen.getByRole('button', { name: '骨' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: '软组织' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.getByRole('button', { name: '肺' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await user.click(screen.getByRole('button', { name: '软组织' }))
  await user.click(screen.getByRole('button', { name: '肺' }))
  await user.click(screen.getByRole('button', { name: '重置高级 3D' }))

  expect(handlers.onPresetChange).toHaveBeenNthCalledWith(1, 'CT-Soft-Tissue')
  expect(handlers.onPresetChange).toHaveBeenNthCalledWith(2, 'CT-Lung')
  expect(handlers.onReset).toHaveBeenCalledOnce()
})

it('disables every control that can change the runtime while busy', () => {
  const view = renderToolbar({ busy: true })

  for (const name of [
    '体绘制',
    'MIP',
    '表面重建',
    '骨',
    '软组织',
    '肺',
    '重置高级 3D',
  ]) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }

  view.onModeChange.mockClear()
})

it('disables MIP direction and thickness controls while busy', () => {
  renderToolbar({ busy: true, mode: 'mip' })

  for (const name of ['前方', '后方', '左侧', '右侧', '头侧', '足侧']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByRole('slider', { name: 'MIP 投影厚度' })).toBeDisabled()
  expect(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' })).toBeDisabled()
})

it('shows only synchronized actual-HU threshold controls and applies the current surface value', async () => {
  const handlers = renderToolbar({
    mode: 'surface',
    surfaceRange: [-800, 1200],
    surfaceThreshold: 300,
  })
  const user = userEvent.setup()

  expect(screen.queryByRole('group', { name: '体绘制预设' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('MIP 投影厚度')).not.toBeInTheDocument()
  expect(screen.getAllByLabelText('表面阈值')).toHaveLength(2)
  expect(screen.getByRole('slider', { name: '表面阈值' })).toHaveValue('300')
  expect(screen.getByRole('spinbutton', { name: '表面阈值' })).toHaveValue(300)
  expect(screen.getByText('最小 -800 HU')).toBeVisible()
  expect(screen.getByText('最大 1200 HU')).toBeVisible()

  fireEvent.change(screen.getByRole('spinbutton', { name: '表面阈值' }), {
    target: { value: '9000' },
  })
  expect(handlers.onSurfaceThresholdChange).toHaveBeenLastCalledWith(1200)

  await user.click(screen.getByRole('button', { name: '应用阈值' }))
  expect(handlers.onApplySurfaceThreshold).toHaveBeenCalledOnce()
})

it('disables every conflicting surface control while building', () => {
  renderToolbar({ busy: true, mode: 'surface' })

  for (const name of ['体绘制', 'MIP', '表面重建', '应用阈值', '重置高级 3D']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByRole('slider', { name: '表面阈值' })).toBeDisabled()
  expect(screen.getByRole('spinbutton', { name: '表面阈值' })).toBeDisabled()
})

it('discloses reduced surface sampling only when stride is greater than one', () => {
  const view = renderToolbar({ mode: 'surface', surfaceStride: 3 })

  expect(screen.getByText('为保证浏览器响应，已降低表面采样密度（步长 3）')).toBeVisible()

  view.onReset.mockClear()
})
