import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { createAdvanced3dRuntime } from '../core/advanced3dCornerstone'
import { Advanced3dViewport } from './Advanced3dViewport'


vi.mock('../core/advanced3dCornerstone', () => ({
  createAdvanced3dRuntime: vi.fn(),
}))

function fakeRuntime() {
  return {
    destroy: vi.fn(),
    getMipThicknessRange: vi.fn().mockReturnValue([0.7, 180]),
    getSurfaceRange: vi.fn<() => readonly [number, number] | null>()
      .mockReturnValue([-1000, 2000]),
    resize: vi.fn(),
    reset: vi.fn(),
    setDirection: vi.fn(),
    setMipThickness: vi.fn(),
    setMode: vi.fn().mockResolvedValue(undefined),
    setPreset: vi.fn(),
    setSurfaceThreshold: vi.fn().mockResolvedValue({
      kind: 'empty',
      stride: 1,
      thresholdHu: 300,
    }),
  }
}

function runtimeCallbacks(callIndex = 0) {
  return vi.mocked(createAdvanced3dRuntime).mock.calls[callIndex][2]
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('renders one focusable canvas and enables controls only after volume readiness', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)

  render(<Advanced3dViewport imageIds={['a', 'b', 'c']} />)

  const canvas = screen.getByLabelText('CT 高级 3D 图像画布')
  expect(canvas).toHaveAttribute('tabindex', '0')
  expect(screen.getByText('正在构建高级 3D…')).toBeVisible()
  expect(screen.getByText('已处理 0 / 3 张')).toBeVisible()
  expect(screen.getByText('当前模式：体绘制')).toBeVisible()
  expect(screen.getByRole('button', { name: '骨' })).toBeDisabled()

  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onProgress({ loaded: 2, processed: 2, total: 3 }))
  expect(screen.getByText('已处理 2 / 3 张')).toBeVisible()

  act(() => runtimeCallbacks().onReady())
  expect(screen.queryByText('正在构建高级 3D…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '骨' })).toBeEnabled()
})

it('resizes immediately when the current runtime resolves', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)

  render(<Advanced3dViewport imageIds={['a', 'b']} />)

  await waitFor(() => expect(runtime.resize).toHaveBeenCalledOnce())
})

it('restores canvas keyboard focus after Cornerstone initializes it', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockImplementation(async ({ viewport }) => {
    viewport.tabIndex = -1
    return runtime
  })

  render(<Advanced3dViewport imageIds={['a', 'b']} />)

  const canvas = screen.getByLabelText('CT 高级 3D 图像画布')
  await waitFor(() => expect(runtime.resize).toHaveBeenCalledOnce())
  expect(canvas).toHaveAttribute('tabindex', '0')
})

it('resizes on viewport observation and disconnects the observer on cleanup', async () => {
  const runtime = fakeRuntime()
  let resizeCallback!: ResizeObserverCallback
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback
    }

    disconnect = disconnect
    observe = observe
  })
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)

  const view = render(<Advanced3dViewport imageIds={['a', 'b']} />)
  const canvas = screen.getByLabelText('CT 高级 3D 图像画布')
  await waitFor(() => expect(runtime.resize).toHaveBeenCalledOnce())
  expect(observe).toHaveBeenCalledWith(canvas)

  act(() => resizeCallback([], {} as ResizeObserver))
  expect(runtime.resize).toHaveBeenCalledTimes(2)

  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('disconnects an old observer and ignores its callback after imageIds change', async () => {
  const first = fakeRuntime()
  const second = fakeRuntime()
  const observers: Array<{
    callback: ResizeObserverCallback
    disconnect: ReturnType<typeof vi.fn>
    observe: ReturnType<typeof vi.fn>
  }> = []
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    callback: ResizeObserverCallback
    disconnect = vi.fn()
    observe = vi.fn()

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.push(this)
    }
  })
  vi.mocked(createAdvanced3dRuntime)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)

  const view = render(<Advanced3dViewport imageIds={['a']} />)
  await waitFor(() => expect(first.resize).toHaveBeenCalledOnce())
  view.rerender(<Advanced3dViewport imageIds={['b']} />)
  await waitFor(() => expect(second.resize).toHaveBeenCalledOnce())
  expect(observers[0].disconnect).toHaveBeenCalledOnce()

  act(() => observers[0].callback([], {} as ResizeObserver))

  expect(first.resize).toHaveBeenCalledOnce()
  expect(second.resize).toHaveBeenCalledOnce()
  expect(observers[1].observe).toHaveBeenCalledWith(
    screen.getByLabelText('CT 高级 3D 图像画布'),
  )
})

it('applies volume presets, switches only the requested mode, and resets defaults', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())

  await user.click(screen.getByRole('button', { name: '软组织' }))
  expect(runtime.setPreset).toHaveBeenCalledWith('CT-Soft-Tissue')
  expect(screen.getByRole('button', { name: '软组织' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await user.click(screen.getByRole('button', { name: '表面重建' }))
  expect(runtime.setMode).toHaveBeenCalledWith('surface')
  expect(runtime.setSurfaceThreshold).not.toHaveBeenCalled()
  expect(screen.getByText('当前模式：表面重建')).toBeVisible()
  expect(screen.getByText('当前阈值 300 HU')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'MIP' }))
  expect(runtime.setMode).toHaveBeenCalledWith('mip')
  expect(runtime.setSurfaceThreshold).not.toHaveBeenCalled()
  expect(screen.getByText('当前模式：MIP')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '重置高级 3D' }))
  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(screen.getByText('当前模式：体绘制')).toBeVisible()
  expect(screen.getByRole('button', { name: '骨' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

it('uses the actual surface range and midpoint when 300 HU is unavailable', async () => {
  const runtime = fakeRuntime()
  runtime.getSurfaceRange
    .mockReturnValueOnce([0, 0])
    .mockReturnValue([500, 900])
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(runtime.getSurfaceRange).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))

  expect(screen.getByRole('spinbutton', { name: '表面阈值' })).toHaveValue(700)
  expect(screen.getByText('最小 500 HU')).toBeVisible()
  expect(screen.getByText('最大 900 HU')).toBeVisible()
  expect(runtime.setSurfaceThreshold).not.toHaveBeenCalled()
})

it('keeps volume and MIP available when surface has no finite HU range', async () => {
  const runtime = fakeRuntime()
  runtime.getSurfaceRange.mockReturnValue(null)
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())

  expect(screen.getByRole('button', { name: '体绘制' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'MIP' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '表面重建' })).toBeDisabled()
  expect(screen.getByText(
    '当前 CT 无法提供有效 HU 范围，表面重建不可用',
  )).toBeVisible()
})

it('yields one animation frame, disables conflicts while building, and reports a ready surface with stride', async () => {
  const runtime = fakeRuntime()
  runtime.setSurfaceThreshold.mockResolvedValue({
    kind: 'ready',
    stride: 3,
    thresholdHu: 450,
  })
  let animationFrameCallback: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    animationFrameCallback = callback
    return 1
  }))
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '表面阈值' }), {
    target: { value: '450' },
  })

  await user.click(screen.getByRole('button', { name: '应用阈值' }))

  expect(screen.getByText('正在重建表面…')).toBeVisible()
  expect(runtime.setSurfaceThreshold).not.toHaveBeenCalled()
  for (const name of ['体绘制', 'MIP', '表面重建', '应用阈值', '重置高级 3D']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }

  await act(async () => animationFrameCallback?.(0))

  expect(runtime.setSurfaceThreshold).toHaveBeenCalledWith(450)
  expect(screen.getByText('表面已生成：450 HU')).toBeVisible()
  expect(screen.getByText('为保证浏览器响应，已降低表面采样密度（步长 3）')).toBeVisible()
  expect(screen.getByRole('button', { name: '体绘制' })).toBeEnabled()
})

it('reports empty and fixed surface errors without turning them into page runtime errors', async () => {
  const runtime = fakeRuntime()
  runtime.setSurfaceThreshold
    .mockResolvedValueOnce({ kind: 'empty', stride: 1, thresholdHu: 300 })
    .mockRejectedValueOnce(new Error('private vtk allocation failure'))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }))
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))

  await user.click(screen.getByRole('button', { name: '应用阈值' }))
  expect(await screen.findByText('该阈值未生成可见表面')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '应用阈值' }))
  expect(await screen.findByText('无法重建表面，请调整阈值或切换其他模式')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent(/private|vtk|allocation/i)

  await user.click(screen.getByRole('button', { name: '体绘制' }))
  expect(runtime.setMode).toHaveBeenLastCalledWith('volume')
  expect(screen.getByText('高级 3D 已就绪')).toBeVisible()
})

it('resets a generated surface to volume mode and the default threshold state', async () => {
  const runtime = fakeRuntime()
  runtime.setSurfaceThreshold.mockResolvedValue({
    kind: 'ready',
    stride: 4,
    thresholdHu: 450,
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }))
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '表面阈值' }), {
    target: { value: '450' },
  })
  await user.click(screen.getByRole('button', { name: '应用阈值' }))
  expect(await screen.findByText('表面已生成：450 HU')).toBeVisible()

  await user.click(screen.getByRole('button', { name: '重置高级 3D' }))

  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(screen.getByText('当前模式：体绘制')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '表面重建' }))
  expect(screen.getByRole('spinbutton', { name: '表面阈值' })).toHaveValue(300)
  expect(screen.getByText('当前阈值 300 HU')).toBeVisible()
  expect(screen.queryByText(/已降低表面采样密度/)).not.toBeInTheDocument()
})

it('ignores a surface result from an old imageIds runtime', async () => {
  const first = fakeRuntime()
  const second = fakeRuntime()
  let resolveSurface!: (result: { kind: 'ready'; stride: number; thresholdHu: number }) => void
  first.setSurfaceThreshold.mockReturnValue(
    new Promise((resolve) => { resolveSurface = resolve }),
  )
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }))
  vi.mocked(createAdvanced3dRuntime)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const user = userEvent.setup()

  const view = render(<Advanced3dViewport imageIds={['a']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))
  await user.click(screen.getByRole('button', { name: '应用阈值' }))
  await waitFor(() => expect(first.setSurfaceThreshold).toHaveBeenCalledOnce())

  view.rerender(<Advanced3dViewport imageIds={['b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledTimes(2))
  act(() => runtimeCallbacks(1).onReady())
  await act(async () => resolveSurface({ kind: 'ready', stride: 5, thresholdHu: 300 }))

  expect(screen.queryByText('表面已生成：300 HU')).not.toBeInTheDocument()
  expect(screen.getByText('当前模式：体绘制')).toBeVisible()
})

it('clears surface busy state when a same-frame mode switch cancels the build', async () => {
  const runtime = fakeRuntime()
  let frameCallback!: FrameRequestCallback
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frameCallback = callback
    return 1
  }))
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())
  await user.click(screen.getByRole('button', { name: '表面重建' }))

  act(() => {
    fireEvent.click(screen.getByRole('button', { name: '应用阈值' }))
    fireEvent.click(screen.getByRole('button', { name: 'MIP' }))
  })
  act(() => frameCallback(0))

  expect(runtime.setSurfaceThreshold).not.toHaveBeenCalled()
  expect(screen.getByText('当前模式：MIP')).toBeVisible()
  expect(screen.getByRole('button', { name: '体绘制' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '重置高级 3D' })).toBeEnabled()
})

it('enters MIP at anterior full thickness, supports standard and free views, and restores volume preset', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())

  await user.click(screen.getByRole('button', { name: '软组织' }))
  await user.click(screen.getByRole('button', { name: 'MIP' }))

  expect(runtime.setMode).toHaveBeenLastCalledWith('mip')
  expect(runtime.setDirection).toHaveBeenLastCalledWith('anterior')
  expect(runtime.setMipThickness).toHaveBeenLastCalledWith(180)
  expect(screen.getByText('当前方向：前方')).toBeVisible()
  expect(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' })).toHaveValue(180)

  await user.click(screen.getByRole('button', { name: '足侧' }))
  expect(runtime.setDirection).toHaveBeenLastCalledWith('inferior')
  expect(screen.getByRole('button', { name: '足侧' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const canvas = screen.getByLabelText('CT 高级 3D 图像画布')
  fireEvent.pointerDown(canvas, {
    button: 0,
    clientX: 10,
    clientY: 10,
  })
  expect(screen.queryByText('自由视角')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '足侧' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  fireEvent.pointerMove(canvas, {
    buttons: 1,
    clientX: 13,
    clientY: 10,
  })
  expect(screen.getByText('自由视角')).toBeVisible()

  fireEvent.change(screen.getByRole('slider', { name: 'MIP 投影厚度' }), {
    target: { value: '25' },
  })
  expect(runtime.setMipThickness).toHaveBeenLastCalledWith(25)

  await user.click(screen.getByRole('button', { name: '体绘制' }))
  expect(runtime.setMode).toHaveBeenLastCalledWith('volume')
  expect(screen.getByRole('button', { name: '软组织' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await user.click(screen.getByRole('button', { name: '重置高级 3D' }))
  expect(runtime.reset).toHaveBeenCalledOnce()
  expect(screen.getByText('当前模式：体绘制')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'MIP' }))
  expect(screen.getByText('当前方向：前方')).toBeVisible()
  expect(screen.getByRole('spinbutton', { name: 'MIP 投影厚度' })).toHaveValue(180)
})

it('ignores stale mode promise errors after a newer mode action', async () => {
  const runtime = fakeRuntime()
  let rejectMip!: (error: unknown) => void
  runtime.setMode
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectMip = reject }))
    .mockResolvedValueOnce(undefined)
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onReady())

  await user.click(screen.getByRole('button', { name: 'MIP' }))
  await user.click(screen.getByRole('button', { name: '体绘制' }))
  await act(async () => rejectMip(new Error('private stale mode failure')))

  expect(screen.getByText('当前模式：体绘制')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not let a stale runtime promise overwrite the current runtime', async () => {
  const first = fakeRuntime()
  const second = fakeRuntime()
  let resolveFirst!: (runtime: ReturnType<typeof fakeRuntime>) => void
  vi.mocked(createAdvanced3dRuntime)
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce(second)
  const user = userEvent.setup()

  const view = render(<Advanced3dViewport imageIds={['a']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  view.rerender(<Advanced3dViewport imageIds={['b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledTimes(2))
  act(() => runtimeCallbacks(1).onReady())
  await act(async () => resolveFirst(first))

  await user.click(screen.getByRole('button', { name: 'MIP' }))
  expect(second.setMode).toHaveBeenCalledWith('mip')
  expect(first.setMode).not.toHaveBeenCalled()
  expect(first.destroy).toHaveBeenCalledOnce()
})

it('keeps approved runtime errors, hides unknown details, and retries with cleanup', async () => {
  const first = fakeRuntime()
  const second = fakeRuntime()
  let firstSignal: AbortSignal | undefined
  let abortedBeforeDestroy = false
  first.destroy.mockImplementation(() => {
    abortedBeforeDestroy = firstSignal?.aborted === true
  })
  vi.mocked(createAdvanced3dRuntime)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const user = userEvent.setup()

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  firstSignal = vi.mocked(createAdvanced3dRuntime).mock.calls[0][3]

  act(() => runtimeCallbacks().onError('codec C:\\private\\decoder.dll'))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '无法构建高级 3D，请重试或返回轴位查看器',
  )
  expect(document.body).not.toHaveTextContent(/codec|private|decoder/i)

  await user.click(screen.getByRole('button', { name: '重试高级 3D' }))
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledTimes(2))
  expect(firstSignal?.aborted).toBe(true)
  expect(first.destroy).toHaveBeenCalledOnce()
  expect(abortedBeforeDestroy).toBe(true)

  act(() => runtimeCallbacks(1).onError('本机 DICOM 文件缺失，请恢复文件后重试'))
  expect(screen.getByRole('alert')).toHaveTextContent(
    '本机 DICOM 文件缺失，请恢复文件后重试',
  )
})

it('does not offer retry when the browser cannot provide 3D graphics', async () => {
  const runtime = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)

  render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  act(() => runtimeCallbacks().onError(
    '当前浏览器无法使用高级 3D，请使用支持三维图形的现代浏览器',
  ))

  expect(screen.getByRole('alert')).toHaveTextContent(
    '当前浏览器无法使用高级 3D，请使用支持三维图形的现代浏览器',
  )
  expect(screen.queryByRole('button', { name: '重试高级 3D' }))
    .not.toBeInTheDocument()
})

it('delegates product retry to the parent and cleans up when validation unmounts it', async () => {
  const runtime = fakeRuntime()
  const onRetry = vi.fn()
  let signal: AbortSignal | undefined
  let abortedBeforeDestroy = false
  runtime.destroy.mockImplementation(() => {
    abortedBeforeDestroy = signal?.aborted === true
  })
  vi.mocked(createAdvanced3dRuntime).mockResolvedValue(runtime)
  const user = userEvent.setup()

  function Harness() {
    const [validating, setValidating] = useState(false)
    return validating ? (
      <p>正在重新校验 Series…</p>
    ) : (
      <Advanced3dViewport
        imageIds={['a', 'b']}
        onRetry={() => {
          onRetry()
          setValidating(true)
        }}
      />
    )
  }

  render(<Harness />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  signal = vi.mocked(createAdvanced3dRuntime).mock.calls[0][3]
  act(() => runtimeCallbacks().onError('private runtime failure'))

  await user.click(screen.getByRole('button', { name: '重试高级 3D' }))

  expect(onRetry).toHaveBeenCalledOnce()
  expect(screen.getByText('正在重新校验 Series…')).toBeVisible()
  expect(signal?.aborted).toBe(true)
  expect(runtime.destroy).toHaveBeenCalledOnce()
  expect(abortedBeforeDestroy).toBe(true)
  expect(createAdvanced3dRuntime).toHaveBeenCalledOnce()
})

it('destroys the old runtime on imageIds changes and ignores its late callbacks', async () => {
  const first = fakeRuntime()
  const second = fakeRuntime()
  vi.mocked(createAdvanced3dRuntime)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)

  const view = render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  const oldCallbacks = runtimeCallbacks()
  const oldSignal = vi.mocked(createAdvanced3dRuntime).mock.calls[0][3]

  view.rerender(<Advanced3dViewport imageIds={['c', 'd', 'e']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledTimes(2))
  expect(oldSignal?.aborted).toBe(true)
  expect(first.destroy).toHaveBeenCalledOnce()
  expect(screen.getByText('已处理 0 / 3 张')).toBeVisible()

  act(() => {
    oldCallbacks.onProgress({ loaded: 2, processed: 2, total: 2 })
    oldCallbacks.onReady()
    oldCallbacks.onError('本机 DICOM 文件缺失，请恢复文件后重试')
  })
  expect(screen.getByText('已处理 0 / 3 张')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '骨' })).toBeDisabled()

  act(() => runtimeCallbacks(1).onReady())
  expect(screen.getByRole('button', { name: '骨' })).toBeEnabled()
})

it('aborts an unfinished creation and destroys a runtime that resolves after unmount', async () => {
  const runtime = fakeRuntime()
  let resolveRuntime!: (value: ReturnType<typeof fakeRuntime>) => void
  vi.mocked(createAdvanced3dRuntime).mockReturnValue(
    new Promise((resolve) => { resolveRuntime = resolve }),
  )

  const view = render(<Advanced3dViewport imageIds={['a', 'b']} />)
  await waitFor(() => expect(createAdvanced3dRuntime).toHaveBeenCalledOnce())
  const signal = vi.mocked(createAdvanced3dRuntime).mock.calls[0][3]
  view.unmount()
  expect(signal?.aborted).toBe(true)

  await act(async () => resolveRuntime(runtime))
  await waitFor(() => expect(runtime.destroy).toHaveBeenCalledOnce())
})
