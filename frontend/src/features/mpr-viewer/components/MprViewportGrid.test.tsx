import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { createMprRuntime } from '../core/mprCornerstone'
import { MprViewportGrid } from './MprViewportGrid'


vi.mock('../core/mprCornerstone', () => ({ createMprRuntime: vi.fn() }))

function fakeRuntime() {
  return {
    activateTool: vi.fn(),
    destroy: vi.fn(),
    reset: vi.fn(),
    resize: vi.fn(),
    setCrosshairsVisible: vi.fn(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

it('renders three focusable viewports with axial active by default', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)

  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)

  const axial = screen.getByLabelText('CT 轴位图像画布')
  const coronal = screen.getByLabelText('CT 冠状位图像画布')
  const sagittal = screen.getByLabelText('CT 矢状位图像画布')
  expect(axial).toHaveAttribute('tabindex', '0')
  expect(coronal).toHaveAttribute('tabindex', '0')
  expect(sagittal).toHaveAttribute('tabindex', '0')
  expect(within(axial.parentElement!).getByText('当前活动视图')).toBeVisible()
  expect(within(coronal.parentElement!).getByText('非活动视图')).toBeVisible()
  expect(within(sagittal.parentElement!).getByText('非活动视图')).toBeVisible()
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  expect(runtime.resize).toHaveBeenCalledOnce()
})

it('reports center positions, loading progress, and ready state from the runtime', async () => {
  vi.mocked(createMprRuntime).mockResolvedValue(fakeRuntime())
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  expect(screen.getByText('正在构建三视图…')).toBeVisible()
  act(() => callbacks.onProgress({ loaded: 1, processed: 2, total: 3 }))
  expect(screen.getByText('已处理 2 / 3 张')).toBeVisible()

  act(() => {
    callbacks.onPosition('axial', [10.25, -3.5, 42])
    callbacks.onPosition('coronal', [10.25, -3.5, 42])
    callbacks.onPosition('sagittal', [10.25, -3.5, 42])
  })
  expect(screen.getAllByText('位置：10.3, -3.5, 42.0 mm')).toHaveLength(3)

  act(() => callbacks.onReady())
  expect(screen.getByText('三视图已就绪')).toBeVisible()
  expect(screen.queryByText('正在构建三视图…')).not.toBeInTheDocument()
})

it('shows the active viewport name when the runtime activates another plane', async () => {
  vi.mocked(createMprRuntime).mockResolvedValue(fakeRuntime())
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  expect(screen.getByText('当前视图：轴位')).toBeVisible()
  act(() => callbacks.onActiveViewport('coronal'))
  expect(screen.getByText('当前视图：冠状位')).toBeVisible()
})

it('keeps tools disabled until ready and activates one Primary tool at a time', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  expect(screen.getByRole('button', { name: '十字定位' })).toBeDisabled()
  act(() => callbacks.onReady())
  await user.click(screen.getByRole('button', { name: '平移' }))

  expect(runtime.activateTool).toHaveBeenCalledWith('pan')
  expect(screen.getByRole('button', { name: '平移' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '十字定位' })).toHaveAttribute('aria-pressed', 'false')
})

it('preserves position while hiding and showing Crosshairs without restoring it as Primary', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]
  act(() => {
    callbacks.onReady()
    callbacks.onPosition('axial', [10, 20, 30])
    callbacks.onPosition('coronal', [10, 20, 30])
    callbacks.onPosition('sagittal', [10, 20, 30])
  })

  await user.click(screen.getByRole('button', { name: '隐藏十字定位线' }))
  expect(runtime.setCrosshairsVisible).toHaveBeenCalledWith(false)
  expect(screen.getAllByText('位置：10.0, 20.0, 30.0 mm')).toHaveLength(3)
  expect(screen.getByRole('button', { name: '窗宽窗位' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByRole('button', { name: '显示十字定位线' }))
  expect(runtime.setCrosshairsVisible).toHaveBeenCalledWith(true)
  expect(screen.getByRole('button', { name: '窗宽窗位' })).toHaveAttribute('aria-pressed', 'true')
})

it('resets React state before the runtime reports the real volume center', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]
  act(() => {
    callbacks.onReady()
    callbacks.onActiveViewport('sagittal')
    callbacks.onPosition('axial', [10, 20, 30])
    callbacks.onPosition('coronal', [10, 20, 30])
    callbacks.onPosition('sagittal', [10, 20, 30])
  })
  await user.click(screen.getByRole('button', { name: '平移' }))
  await user.click(screen.getByRole('button', { name: '隐藏十字定位线' }))

  await user.click(screen.getByRole('button', { name: '重置三视图' }))

  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(screen.getByText('当前视图：轴位')).toBeVisible()
  expect(screen.getByRole('button', { name: '十字定位' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '隐藏十字定位线' })).toBeEnabled()
  expect(screen.getAllByText('位置：0.0, 0.0, 0.0 mm')).toHaveLength(3)
})

it('aborts creation and destroys the runtime when unmounted', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const { unmount } = render(<MprViewportGrid imageIds={['a', 'b']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const signal = vi.mocked(createMprRuntime).mock.calls[0][3]

  unmount()

  expect(signal).toBeDefined()
  expect(signal!.aborted).toBe(true)
  expect(runtime.destroy).toHaveBeenCalledOnce()
})

it('shows a safe creation error and retry starts a fresh runtime attempt', async () => {
  const recoveredRuntime = fakeRuntime()
  vi.mocked(createMprRuntime)
    .mockRejectedValueOnce(new Error(String.raw`WebGL C:\private\stack failed`))
    .mockResolvedValueOnce(recoveredRuntime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} />)

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('无法构建三视图，请重试或返回轴位查看器')
  expect(alert).not.toHaveTextContent(/WebGL|private|stack/i)
  const firstSignal = vi.mocked(createMprRuntime).mock.calls[0][3]

  await user.click(screen.getByRole('button', { name: '重试三视图' }))

  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledTimes(2))
  const secondSignal = vi.mocked(createMprRuntime).mock.calls[1][3]
  expect(firstSignal?.aborted).toBe(true)
  expect(secondSignal).not.toBe(firstSignal)
  expect(secondSignal?.aborted).toBe(false)
  expect(recoveredRuntime.resize).toHaveBeenCalledOnce()
})

it('preserves an approved runtime error when creation reports and then rejects', async () => {
  const missingFileMessage = '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器'
  vi.mocked(createMprRuntime).mockImplementationOnce(async (_elements, _imageIds, callbacks) => {
    callbacks.onError(missingFileMessage)
    throw new Error(missingFileMessage)
  })
  render(<MprViewportGrid imageIds={['a', 'b']} />)

  expect(await screen.findByRole('alert')).toHaveTextContent(missingFileMessage)
})

it('keeps a safe partial failure visible and destroys the failed runtime before retry', async () => {
  const failedRuntime = fakeRuntime()
  const retryRuntime = fakeRuntime()
  vi.mocked(createMprRuntime)
    .mockResolvedValueOnce(failedRuntime)
    .mockResolvedValueOnce(retryRuntime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const firstCallbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  act(() => firstCallbacks.onError(
    '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器',
  ))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器',
  )

  await user.click(screen.getByRole('button', { name: '重试三视图' }))

  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledTimes(2))
  expect(failedRuntime.destroy).toHaveBeenCalledOnce()
  expect(retryRuntime.resize).toHaveBeenCalledOnce()
  act(() => firstCallbacks.onReady())
  expect(screen.queryByText('三视图已就绪')).not.toBeInTheDocument()
})

it('preserves approved runtime error messages and replaces unknown internal text', async () => {
  vi.mocked(createMprRuntime).mockResolvedValue(fakeRuntime())
  render(<MprViewportGrid imageIds={['a', 'b']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  act(() => callbacks.onError(
    '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
  ))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
  )

  act(() => callbacks.onError(String.raw`WebGL C:\private\stack failed`))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '无法构建三视图，请重试或返回轴位查看器',
  )
  expect(screen.getByRole('alert')).not.toHaveTextContent(/WebGL|private|stack/i)
})

it('destroys a runtime that resolves after unmount without updating React state', async () => {
  const lateRuntime = fakeRuntime()
  let resolveRuntime!: (runtime: ReturnType<typeof fakeRuntime>) => void
  vi.mocked(createMprRuntime).mockImplementationOnce(
    () => new Promise((resolve) => { resolveRuntime = resolve }),
  )
  const { unmount } = render(<MprViewportGrid imageIds={['a', 'b']} />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())

  unmount()
  await act(async () => resolveRuntime(lateRuntime))

  expect(lateRuntime.destroy).toHaveBeenCalledOnce()
  expect(lateRuntime.resize).not.toHaveBeenCalled()
})
