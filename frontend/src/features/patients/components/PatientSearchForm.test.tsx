import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PatientSearchForm } from './PatientSearchForm'


describe('PatientSearchForm', () => {
  it('trims submitted text and clears back to the complete list', async () => {
    const user = userEvent.setup()
    const onSearch = vi.fn()
    render(<PatientSearchForm onSearch={onSearch} searching={false} />)

    const input = screen.getByLabelText('搜索病人')
    await user.type(input, '  Alpha Person  ')
    await user.click(screen.getByRole('button', { name: '搜索' }))

    expect(onSearch).toHaveBeenLastCalledWith('Alpha Person')

    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(input).toHaveValue('')
    expect(onSearch).toHaveBeenLastCalledWith('')
  })
})
