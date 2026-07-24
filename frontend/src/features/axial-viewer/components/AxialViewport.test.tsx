import { StrictMode } from 'react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as cornerstone from '../core/cornerstone'
import { AxialViewport } from './AxialViewport'


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


vi.mock('../core/cornerstone', () => ({
  createAxialViewportRuntime: vi.fn(),
  initializeCornerstone: vi.fn(),
  toSafeViewerError: vi.fn((error: unknown) =>
    String(error).includes('无法解码')
      ? '无法解码该影像，请重试或返回病人管理'
      : String(error),
  ),
}))

const runtime = {
  activateTool: vi.fn(),
  applyState: vi.fn(),
  captureState: vi.fn(),
  clearAnnotations: vi.fn(),
  destroy: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  reset: vi.fn(),
  resize: vi.fn(),
  retry: vi.fn(),
}

let resizeCallback: ResizeObserverCallback

beforeAll(() => {
  if (HTMLDialogElement.prototype.showModal === undefined) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    },
  )
  vi.mocked(cornerstone.initializeCornerstone).mockResolvedValue({} as never)
  vi.mocked(cornerstone.createAxialViewportRuntime).mockResolvedValue(runtime)
  runtime.applyState.mockResolvedValue({ restored: 0, skipped: 0 })
  runtime.captureState.mockReturnValue({
    state: {
      image_index: 1,
      active_tool: 'windowLevel',
      presentation: null,
      voi: null,
    },
    annotations: [],
  })
  viewerStateMocks.getViewerState.mockResolvedValue(null)
  viewerStateMocks.createWriter.mockReturnValue(viewerStateMocks.writer)
  viewerStateMocks.writer.clear.mockResolvedValue(undefined)
  viewerStateMocks.writer.destroy.mockResolvedValue(undefined)
  viewerStateMocks.writer.flush.mockResolvedValue(undefined)
})

it('does not create overlapping runtimes during StrictMode initialization', async () => {
  let resolveInitialization!: (value: never) => void
  const initialization = new Promise<never>((resolve) => {
    resolveInitialization = resolve
  })
  vi.mocked(cornerstone.initializeCornerstone).mockReturnValue(initialization)

  render(
    <StrictMode>
      <AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />
    </StrictMode>,
  )

  expect(cornerstone.createAxialViewportRuntime).not.toHaveBeenCalled()
  resolveInitialization({} as never)

  await waitFor(() => {
    expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce()
  })
})

it.each([
  [['a'], 0],
  [['a', 'b', 'c'], 1],
  [['a', 'b', 'c', 'd'], 2],
])('starts %j at middle index %i and destroys runtime', async (imageIds, expected) => {
  const { unmount } = render(
    <AxialViewport imageIds={imageIds} seriesId="series" />,
  )

  await waitFor(() => {
    expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      imageIds,
      expected,
      expect.any(Function),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.objectContaining({
        onAnnotationCountChange: expect.any(Function),
        onCalibrationChange: expect.any(Function),
        onTextRequest: expect.any(Function),
      }),
      expect.any(Function),
    )
  })

  unmount()
  expect(runtime.destroy).toHaveBeenCalledOnce()
})

it('aborts pending runtime creation when the viewport unmounts', async () => {
  vi.mocked(cornerstone.createAxialViewportRuntime).mockImplementationOnce(
    () => new Promise(() => undefined),
  )
  const { unmount } = render(
    <AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />,
  )

  await waitFor(() => {
    expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce()
  })
  const signal = vi.mocked(cornerstone.createAxialViewportRuntime).mock.calls[0][5]
  if (signal === undefined) {
    throw new Error('Expected runtime AbortSignal')
  }
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(false)

  unmount()

  expect(signal.aborted).toBe(true)
})

it('activates tools, navigates, and resets through the runtime', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalled())

  await user.click(screen.getByRole('button', { name: '平移' }))
  await user.click(screen.getByRole('button', { name: '上一张' }))
  await user.click(screen.getByRole('button', { name: '下一张' }))
  await user.click(screen.getByRole('button', { name: '重置' }))

  expect(runtime.activateTool).toHaveBeenCalledWith('pan')
  expect(runtime.previous).toHaveBeenCalledOnce()
  expect(runtime.next).toHaveBeenCalledOnce()
  expect(runtime.reset).toHaveBeenCalledOnce()
})

it('integrates measurement state, text requests, clear confirmation, and reset', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalled())
  const callbacks = vi.mocked(cornerstone.createAxialViewportRuntime).mock.calls[0][6]
  if (callbacks === undefined) {
    throw new Error('Expected annotation callbacks')
  }

  act(() => {
    callbacks.onCalibrationChange({ available: true, reason: null })
    callbacks.onAnnotationCountChange(2)
  })
  expect(screen.getByText('当前共有 2 项测量与标注')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '长度' }))
  expect(runtime.activateTool).toHaveBeenCalledWith('length')

  const cancel = vi.fn()
  act(() => {
    callbacks.onTextRequest({
      cancel,
      complete: vi.fn(),
      initialValue: '',
      mode: 'create',
    })
  })
  expect(screen.getByRole('dialog', { name: '添加箭头标注' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(cancel).toHaveBeenCalledOnce()

  act(() => callbacks.onTextRequest(null))
  await user.click(screen.getByRole('button', { name: '全部清空' }))
  expect(screen.getByRole('dialog', { name: '清空测量与标注' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '确认清空' }))
  expect(runtime.clearAnnotations).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: '重置' }))
  expect(runtime.clearAnnotations).toHaveBeenCalledTimes(2)
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledOnce()
})

it('keeps controls disabled until the viewport runtime is ready', async () => {
  let resolveRuntime!: (value: typeof runtime) => void
  vi.mocked(cornerstone.createAxialViewportRuntime).mockReturnValue(
    new Promise((resolve) => {
      resolveRuntime = resolve
    }),
  )
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)

  expect(screen.getByText('正在加载影像…')).toBeVisible()
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
  }

  resolveRuntime(runtime)

  await waitFor(() => {
    expect(screen.queryByText('正在加载影像…')).not.toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: '平移' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '上一张' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '下一张' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '重置' })).toBeEnabled()
})

it('resizes the rendering engine when its container size changes', async () => {
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalled())

  resizeCallback([], {} as ResizeObserver)

  expect(runtime.resize).toHaveBeenCalledOnce()
})

it('shows a safe image error while keeping stack controls and retry', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalled())
  const onError = vi.mocked(cornerstone.createAxialViewportRuntime).mock.calls[0][4]

  onError(String.raw`无法解码该影像 C:\private\codec.dll`)

  expect(await screen.findByRole('alert')).toHaveTextContent('无法解码该影像')
  expect(screen.getByRole('button', { name: '上一张' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '下一张' })).toBeEnabled()
  expect(screen.queryByText(/private/)).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '重试当前影像' }))
  expect(runtime.retry).toHaveBeenCalledOnce()
})

it('loads, applies, schedules, and flushes isolated Series state', async () => {
  const saved = {
    series_id: 'series',
    schema_version: 1 as const,
    state: {
      axial: {
        image_index: 2,
        active_tool: 'pan' as const,
        presentation: null,
        voi: null,
      },
      mpr: null,
      annotations: [],
    },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  }
  viewerStateMocks.getViewerState.mockResolvedValue(saved)
  runtime.captureState.mockReturnValue({
    state: { ...saved.state.axial, image_index: 1 },
    annotations: [],
  })
  const { unmount } = render(
    <AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />,
  )

  await waitFor(() => {
    expect(runtime.applyState).toHaveBeenCalledWith(
      saved.state.axial,
      saved.state.annotations,
    )
  })
  expect(viewerStateMocks.getViewerState).toHaveBeenCalledWith(
    'series',
    expect.any(AbortSignal),
  )
  const onStateChange = vi.mocked(
    cornerstone.createAxialViewportRuntime,
  ).mock.calls[0][7]
  if (onStateChange === undefined) {
    throw new Error('Expected viewer state callback')
  }
  act(() => onStateChange())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledWith({
    axial: expect.objectContaining({ image_index: 1 }),
    mpr: null,
    annotations: [],
  })

  unmount()
  expect(viewerStateMocks.writer.destroy).toHaveBeenCalledOnce()
})

it('hydrates axial annotations even when no axial presentation snapshot exists', async () => {
  const savedAnnotation = {
    viewport: 'axial' as const,
    tool_name: 'Length' as const,
    referenced_image_id: 'a',
    points: [[0, 0, 0], [1, 1, 0]] as [number, number, number][],
    label: null,
    text_box: null,
  }
  const defaultState = {
    image_index: 1,
    active_tool: 'windowLevel' as const,
    presentation: null,
    voi: null,
  }
  viewerStateMocks.getViewerState.mockResolvedValue({
    series_id: 'series',
    schema_version: 1,
    state: { axial: null, mpr: null, annotations: [savedAnnotation] },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  })
  runtime.captureState.mockReturnValue({
    state: defaultState,
    annotations: [savedAnnotation],
  })

  render(<AxialViewport imageIds={['a', 'b']} seriesId="series" />)

  await waitFor(() => {
    expect(runtime.applyState).toHaveBeenCalledWith(defaultState, [savedAnnotation])
  })
  const onStateChange = vi.mocked(
    cornerstone.createAxialViewportRuntime,
  ).mock.calls[0][7]
  if (onStateChange === undefined) {
    throw new Error('Expected viewer state callback')
  }
  act(() => onStateChange())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledWith({
    axial: defaultState,
    mpr: null,
    annotations: [savedAnnotation],
  })
})

it('starts a normal flush as soon as the document becomes hidden', async () => {
  const visibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'visibilityState',
  )
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  })
  try {
    render(<AxialViewport imageIds={['a', 'b']} seriesId="series" />)
    await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce())

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

it('keeps saved state isolated through 20 switches between two Series', async () => {
  const imageIds = ['a', 'b', 'c']
  const stateFor = (seriesId: string) => ({
    series_id: seriesId,
    schema_version: 1 as const,
    state: {
      axial: {
        image_index: seriesId === 'series-a' ? 0 : 2,
        active_tool: seriesId === 'series-a' ? 'pan' as const : 'zoom' as const,
        presentation: null,
        voi: null,
      },
      mpr: null,
      annotations: [],
    },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  })
  viewerStateMocks.getViewerState.mockImplementation((seriesId: string) => (
    Promise.resolve(stateFor(seriesId))
  ))

  const { rerender } = render(
    <AxialViewport imageIds={imageIds} seriesId="series-a" />,
  )
  await waitFor(() => expect(runtime.applyState).toHaveBeenCalledTimes(1))

  const expectedSeries = ['series-a']
  for (let switchIndex = 1; switchIndex <= 20; switchIndex += 1) {
    const seriesId = switchIndex % 2 === 1 ? 'series-b' : 'series-a'
    expectedSeries.push(seriesId)
    rerender(<AxialViewport imageIds={imageIds} seriesId={seriesId} />)
    await waitFor(() => {
      expect(runtime.applyState).toHaveBeenCalledTimes(switchIndex + 1)
    })
    expect(runtime.applyState.mock.calls[switchIndex][0]).toMatchObject({
      image_index: seriesId === 'series-a' ? 0 : 2,
      active_tool: seriesId === 'series-a' ? 'pan' : 'zoom',
    })
  }

  expect(viewerStateMocks.getViewerState.mock.calls.map(([seriesId]) => seriesId))
    .toEqual(expectedSeries)
})

it('keeps the viewport usable when loading saved state fails and can clear the invalid state', async () => {
  viewerStateMocks.getViewerState.mockRejectedValueOnce(new Error('invalid state'))
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)

  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce())
  expect(await screen.findByText('无法读取已保存状态，已使用默认状态')).toBeVisible()
  expect(screen.getByRole('button', { name: '平移' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: '清除已保存状态' }))
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledOnce()
  expect(await screen.findByText('已恢复默认状态并清除保存')).toBeVisible()
})

it('reports partial annotation restore without blocking the viewport', async () => {
  viewerStateMocks.getViewerState.mockResolvedValue({
    series_id: 'series',
    schema_version: 1,
    state: {
      axial: {
        image_index: 2,
        active_tool: 'pan',
        presentation: null,
        voi: null,
      },
      mpr: null,
      annotations: [],
    },
    created_at: '2026-07-23T01:00:00Z',
    updated_at: '2026-07-23T01:00:00Z',
  })
  runtime.applyState.mockResolvedValueOnce({ restored: 3, skipped: 1 })

  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)

  expect(await screen.findByText(
    '已恢复查看状态，1 项标注因影像不匹配而跳过',
  )).toBeVisible()
  expect(screen.getByRole('button', { name: '下一张' })).toBeEnabled()
})

it('announces writer progress and retries a failed save without disabling tools', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce())
  const options = viewerStateMocks.createWriter.mock.calls[0][0]

  act(() => options.onStatus('saving'))
  expect(screen.getByText('正在保存查看状态…')).toBeVisible()
  act(() => options.onStatus('error'))
  expect(screen.getByText('状态保存失败，当前调整仅在本次会话有效')).toBeVisible()
  expect(screen.getByRole('button', { name: '平移' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: '重试保存状态' }))
  expect(viewerStateMocks.writer.flush).toHaveBeenCalledOnce()
  act(() => options.onStatus('saved'))
  expect(screen.getByText('查看状态已保存')).toBeVisible()
})

it('retries a failed reset DELETE and confirms the cleared default state', async () => {
  viewerStateMocks.writer.clear
    .mockRejectedValueOnce(new Error('delete failed'))
    .mockResolvedValueOnce(undefined)
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce())

  await user.click(screen.getByRole('button', { name: '重置' }))
  expect(await screen.findByText('清除保存失败，当前仍使用默认状态')).toBeVisible()
  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(runtime.clearAnnotations).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: '重试清除保存' }))
  expect(viewerStateMocks.writer.clear).toHaveBeenCalledTimes(2)
  expect(await screen.findByText('已恢复默认状态并清除保存')).toBeVisible()
})

it('ignores passive runtime changes after reset until the next user interaction', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} seriesId="series" />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledOnce())
  const onStateChange = vi.mocked(
    cornerstone.createAxialViewportRuntime,
  ).mock.calls[0][7]
  if (onStateChange === undefined) {
    throw new Error('Expected viewer state callback')
  }
  viewerStateMocks.writer.schedule.mockClear()

  await user.click(screen.getByRole('button', { name: '重置' }))
  act(() => onStateChange())
  expect(viewerStateMocks.writer.schedule).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '下一张' }))
  act(() => onStateChange())
  expect(viewerStateMocks.writer.schedule).toHaveBeenCalledOnce()
})
