import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { createMprRuntime } from '../core/mprCornerstone'
import { MprViewportGrid } from './MprViewportGrid'


const viewerStateMocks = vi.hoisted(() => ({
  createWriter: vi.fn(),
  getViewerState: vi.fn(),
  writer: {
    clear: vi.fn(),
    destroy: vi.fn(),
    flush: vi.fn(),
    schedule: vi.fn(),
  },
}))

vi.mock('../../viewer-state/api/viewerStateApi', () => ({
  getViewerState: viewerStateMocks.getViewerState,
}))

vi.mock('../../viewer-state/core/viewerStateWriter', () => ({
  createViewerStateWriter: viewerStateMocks.createWriter,
}))


vi.mock('../core/mprCornerstone', () => ({ createMprRuntime: vi.fn() }))

function fakeRuntime() {
  return {
    activateTool: vi.fn(),
    applyState: vi.fn().mockResolvedValue({ restored: 0, skipped: 0 }),
    captureState: vi.fn().mockReturnValue({
      state: {
        active_viewport: 'axial',
        active_tool: 'crosshairs',
        crosshairs_visible: true,
        crosshairs_position: [0, 0, 0],
        viewports: {
          axial: { presentation: null, voi: null },
          coronal: { presentation: null, voi: null },
          sagittal: { presentation: null, voi: null },
        },
      },
      annotations: [],
    }),
    clearAnnotations: vi.fn(),
    destroy: vi.fn(),
    reset: vi.fn(),
    resize: vi.fn(),
    setCrosshairsVisible: vi.fn(),
  }
}

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  viewerStateMocks.getViewerState.mockResolvedValue(null)
  viewerStateMocks.createWriter.mockReturnValue(viewerStateMocks.writer)
  viewerStateMocks.writer.clear.mockResolvedValue(undefined)
  viewerStateMocks.writer.destroy.mockResolvedValue(undefined)
  viewerStateMocks.writer.flush.mockResolvedValue(undefined)
})

it('renders three focusable viewports with axial active by default', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)

  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)

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
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
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
  expect(await screen.findByText('三视图已就绪')).toBeVisible()
  expect(screen.queryByText('正在构建三视图…')).not.toBeInTheDocument()
})

it('shows the active viewport name when the runtime activates another plane', async () => {
  vi.mocked(createMprRuntime).mockResolvedValue(fakeRuntime())
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
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
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  expect(screen.getByRole('button', { name: '十字定位' })).toBeDisabled()
  act(() => callbacks.onReady())
  await user.click(screen.getByRole('button', { name: '平移' }))

  expect(runtime.activateTool).toHaveBeenCalledWith('pan')
  expect(screen.getByRole('button', { name: '平移' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '十字定位' })).toHaveAttribute('aria-pressed', 'false')
})

it('integrates annotations with the active viewport, clear confirmation, and reset', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const runtimeCallbacks = vi.mocked(createMprRuntime).mock.calls[0][2]
  const annotationCallbacks = vi.mocked(createMprRuntime).mock.calls[0][4]
  if (annotationCallbacks === undefined) {
    throw new Error('Expected annotation callbacks')
  }

  act(() => {
    runtimeCallbacks.onReady()
    runtimeCallbacks.onActiveViewport('coronal')
    annotationCallbacks.onCalibrationChange({ available: true, reason: null })
    annotationCallbacks.onAnnotationCountChange(3)
  })

  await user.click(screen.getByRole('button', { name: '矩形 ROI' }))
  expect(runtime.activateTool).toHaveBeenCalledWith('rectangleRoi')
  expect(screen.getByRole('button', { name: '隐藏十字定位线' })).toBeEnabled()

  const cancel = vi.fn()
  act(() => annotationCallbacks.onTextRequest({
    cancel,
    complete: vi.fn(),
    initialValue: '',
    mode: 'create',
  }))
  expect(screen.getByRole('dialog', { name: '添加箭头标注' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(cancel).toHaveBeenCalledOnce()

  act(() => annotationCallbacks.onTextRequest(null))
  await user.click(screen.getByRole('button', { name: '全部清空' }))
  await user.click(screen.getByRole('button', { name: '确认清空' }))
  expect(runtime.clearAnnotations).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: '重置三视图' }))
  expect(runtime.clearAnnotations).toHaveBeenCalledTimes(2)
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledOnce()
})

it('preserves position while hiding and showing Crosshairs without restoring it as Primary', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
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
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
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
  const { unmount } = render(
    <MprViewportGrid imageIds={['a', 'b']} seriesId="series" />,
  )
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const signal = vi.mocked(createMprRuntime).mock.calls[0][3]

  unmount()

  expect(signal).toBeDefined()
  expect(signal!.aborted).toBe(true)
  expect(runtime.destroy).toHaveBeenCalledOnce()
})

it('starts a normal MPR flush as soon as the document becomes hidden', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'visibilityState',
  )
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  })
  try {
    render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
    await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())

    document.dispatchEvent(new Event('visibilitychange'))

    expect(viewerStateMocks.writer.flush).toHaveBeenCalledWith()
  } finally {
    if (visibilityStateDescriptor === undefined) {
      Reflect.deleteProperty(document, 'visibilityState')
    } else {
      Object.defineProperty(document, 'visibilityState', visibilityStateDescriptor)
    }
  }
})

it('shows a safe creation error and retry starts a fresh runtime attempt', async () => {
  const recoveredRuntime = fakeRuntime()
  vi.mocked(createMprRuntime)
    .mockRejectedValueOnce(new Error(String.raw`WebGL C:\private\stack failed`))
    .mockResolvedValueOnce(recoveredRuntime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)

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
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)

  expect(await screen.findByRole('alert')).toHaveTextContent(missingFileMessage)
})

it('keeps a safe partial failure visible and destroys the failed runtime before retry', async () => {
  const failedRuntime = fakeRuntime()
  const retryRuntime = fakeRuntime()
  vi.mocked(createMprRuntime)
    .mockResolvedValueOnce(failedRuntime)
    .mockResolvedValueOnce(retryRuntime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b', 'c']} seriesId="series" />)
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
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
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
  const { unmount } = render(
    <MprViewportGrid imageIds={['a', 'b']} seriesId="series" />,
  )
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())

  unmount()
  await act(async () => resolveRuntime(lateRuntime))

  expect(lateRuntime.destroy).toHaveBeenCalledOnce()
  expect(lateRuntime.resize).not.toHaveBeenCalled()
})

it('restores and saves MPR while preserving the saved axial state', async () => {
  const runtime = fakeRuntime()
  const saved = {
    series_id: 'series',
    schema_version: 1 as const,
    state: {
      axial: {
        image_index: 7,
        active_tool: 'pan' as const,
        presentation: null,
        voi: null,
      },
      mpr: runtime.captureState().state,
      annotations: [],
    },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  }
  viewerStateMocks.getViewerState.mockResolvedValue(saved)
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const { unmount } = render(
    <MprViewportGrid imageIds={['a', 'b']} seriesId="series" />,
  )

  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]
  act(() => callbacks.onReady())
  await waitFor(() => {
    expect(runtime.applyState).toHaveBeenCalledWith(
      saved.state.mpr,
      saved.state.annotations,
    )
  })
  act(() => callbacks.onStateChange?.())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledWith({
    axial: saved.state.axial,
    mpr: expect.objectContaining({ active_viewport: 'axial' }),
    annotations: [],
  })

  unmount()
  expect(viewerStateMocks.writer.destroy).toHaveBeenCalledOnce()
})

it('hydrates saved axial annotations before the first MPR snapshot', async () => {
  const runtime = fakeRuntime()
  const defaultMpr = fakeRuntime().captureState().state
  const savedAnnotation = {
    viewport: 'axial' as const,
    tool_name: 'Length' as const,
    referenced_image_id: 'a',
    points: [[0, 0, 0], [1, 1, 0]] as [
      [number, number, number],
      [number, number, number],
    ],
    label: null,
    text_box: null,
  }
  runtime.captureState
    .mockReturnValueOnce({ state: defaultMpr, annotations: [] })
    .mockReturnValue({ state: defaultMpr, annotations: [savedAnnotation] })
  viewerStateMocks.getViewerState.mockResolvedValue({
    series_id: 'series',
    schema_version: 1,
    state: {
      axial: {
        image_index: 3,
        active_tool: 'arrowAnnotate',
        presentation: null,
        voi: null,
      },
      mpr: null,
      annotations: [savedAnnotation],
    },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  })
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  act(() => callbacks.onReady())
  await waitFor(() => {
    expect(runtime.applyState).toHaveBeenCalledWith(defaultMpr, [savedAnnotation])
  })

  act(() => callbacks.onStateChange?.())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledWith({
    axial: expect.objectContaining({ image_index: 3 }),
    mpr: defaultMpr,
    annotations: [savedAnnotation],
  })
})

it('uses the default MPR when saved state loading fails and exposes a clear path', async () => {
  const runtime = fakeRuntime()
  viewerStateMocks.getViewerState.mockRejectedValueOnce(new Error('old schema'))
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]

  act(() => callbacks.onReady())
  expect(await screen.findByText('无法读取已保存状态，已使用默认状态')).toBeVisible()
  expect(screen.getByRole('button', { name: '平移' })).toBeEnabled()
  expect(runtime.applyState).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '清除已保存状态' }))
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledOnce()
  expect(await screen.findByText('已恢复默认状态并清除保存')).toBeVisible()
})

it('announces a partial MPR annotation restore', async () => {
  const runtime = fakeRuntime()
  const savedState = runtime.captureState().state
  viewerStateMocks.getViewerState.mockResolvedValue({
    series_id: 'series',
    schema_version: 1,
    state: { axial: null, mpr: savedState, annotations: [] },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  })
  runtime.applyState.mockResolvedValueOnce({ restored: 2, skipped: 1 })
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())

  act(() => vi.mocked(createMprRuntime).mock.calls[0][2].onReady())
  expect(await screen.findByText(
    '已恢复查看状态，1 项标注因影像不匹配而跳过',
  )).toBeVisible()
})

it('keeps MPR usable after a save error and retries the retained snapshot', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  act(() => vi.mocked(createMprRuntime).mock.calls[0][2].onReady())
  await screen.findByText('三视图已就绪')
  const options = viewerStateMocks.createWriter.mock.calls[0][0]

  act(() => options.onStatus('error'))
  expect(screen.getByText('状态保存失败，当前调整仅在本次会话有效')).toBeVisible()
  expect(screen.getByRole('button', { name: '窗宽窗位' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '重试保存状态' }))
  expect(viewerStateMocks.writer.flush).toHaveBeenCalledOnce()
})

it('retries a failed MPR reset DELETE and leaves the runtime at defaults', async () => {
  const runtime = fakeRuntime()
  viewerStateMocks.writer.clear
    .mockRejectedValueOnce(new Error('delete failed'))
    .mockResolvedValueOnce(undefined)
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  act(() => vi.mocked(createMprRuntime).mock.calls[0][2].onReady())

  await user.click(screen.getByRole('button', { name: '重置三视图' }))
  expect(await screen.findByText('清除保存失败，当前仍使用默认状态')).toBeVisible()
  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(runtime.clearAnnotations).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: '重试清除保存' }))
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledTimes(2)
  expect(await screen.findByText('已恢复默认状态并清除保存')).toBeVisible()
})

it('ignores passive MPR changes after reset until the next user interaction', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createMprRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()
  render(<MprViewportGrid imageIds={['a', 'b']} seriesId="series" />)
  await waitFor(() => expect(createMprRuntime).toHaveBeenCalledOnce())
  const callbacks = vi.mocked(createMprRuntime).mock.calls[0][2]
  act(() => callbacks.onReady())
  viewerStateMocks.writer.schedule.mockClear()

  await user.click(screen.getByRole('button', { name: '重置三视图' }))
  act(() => callbacks.onStateChange?.())
  expect(viewerStateMocks.writer.schedule).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '平移' }))
  act(() => callbacks.onStateChange?.())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledOnce()
})
