import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import { ViewportOverlay } from './ViewportOverlay'


it('shows the plane name, non-color active state, one-decimal position, and four directions', () => {
  const { rerender } = render(
    <ViewportOverlay
      active
      label="矢状位"
      orientation={{ top: 'S', right: 'P', bottom: 'I', left: 'A' }}
      position={[10.25, -3.5, 42]}
    />,
  )
  const overlay = screen.getByLabelText('矢状位视图信息')

  expect(within(overlay).getByText('矢状位')).toBeVisible()
  expect(within(overlay).getByText('当前活动视图')).toBeVisible()
  expect(within(overlay).getByText('位置：10.3, -3.5, 42.0 mm')).toBeVisible()
  for (const marker of ['S', 'P', 'I', 'A']) {
    expect(within(overlay).getByText(marker)).toBeVisible()
  }

  rerender(
    <ViewportOverlay
      active={false}
      label="矢状位"
      orientation={{ top: 'S', right: 'P', bottom: 'I', left: 'A' }}
      position={[10.25, -3.5, 42]}
    />,
  )
  expect(within(overlay).getByText('非活动视图')).toBeVisible()
})
