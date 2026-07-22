import { StrictMode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as cornerstone from '../core/cornerstone'
import { AxialViewport } from './AxialViewport'


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
  destroy: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  reset: vi.fn(),
  resize: vi.fn(),
  retry: vi.fn(),
}

let resizeCallback: ResizeObserverCallback

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
})

it('does not create overlapping runtimes during StrictMode initialization', async () => {
  let resolveInitialization!: (value: never) => void
  const initialization = new Promise<never>((resolve) => {
    resolveInitialization = resolve
  })
  vi.mocked(cornerstone.initializeCornerstone).mockReturnValue(initialization)

  render(
    <StrictMode>
      <AxialViewport imageIds={['a', 'b', 'c']} />
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
  const { unmount } = render(<AxialViewport imageIds={imageIds} />)

  await waitFor(() => {
    expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      imageIds,
      expected,
      expect.any(Function),
      expect.any(Function),
      expect.any(AbortSignal),
    )
  })

  unmount()
  expect(runtime.destroy).toHaveBeenCalledOnce()
})

it('aborts pending runtime creation when the viewport unmounts', async () => {
  vi.mocked(cornerstone.createAxialViewportRuntime).mockImplementationOnce(
    () => new Promise(() => undefined),
  )
  const { unmount } = render(<AxialViewport imageIds={['a', 'b', 'c']} />)

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
  render(<AxialViewport imageIds={['a', 'b', 'c']} />)
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

it('keeps controls disabled until the viewport runtime is ready', async () => {
  let resolveRuntime!: (value: typeof runtime) => void
  vi.mocked(cornerstone.createAxialViewportRuntime).mockReturnValue(
    new Promise((resolve) => {
      resolveRuntime = resolve
    }),
  )
  render(<AxialViewport imageIds={['a', 'b', 'c']} />)

  expect(screen.getByRole('status')).toHaveTextContent('正在加载影像')
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled()
  }

  resolveRuntime(runtime)

  await waitFor(() => {
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: '平移' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '上一张' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '下一张' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '重置' })).toBeEnabled()
})

it('resizes the rendering engine when its container size changes', async () => {
  render(<AxialViewport imageIds={['a', 'b', 'c']} />)
  await waitFor(() => expect(cornerstone.createAxialViewportRuntime).toHaveBeenCalled())

  resizeCallback([], {} as ResizeObserver)

  expect(runtime.resize).toHaveBeenCalledOnce()
})

it('shows a safe image error while keeping stack controls and retry', async () => {
  const user = userEvent.setup()
  render(<AxialViewport imageIds={['a', 'b', 'c']} />)
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
