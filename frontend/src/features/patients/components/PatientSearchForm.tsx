import { type FormEvent, useState } from 'react'


interface PatientSearchFormProps {
  onSearch: (query: string) => void
  searching: boolean
}

export function PatientSearchForm({
  onSearch,
  searching,
}: PatientSearchFormProps) {
  const [value, setValue] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch(value.trim())
  }

  function clear() {
    setValue('')
    onSearch('')
  }

  return (
    <form
      aria-busy={searching}
      className="patient-search"
      onSubmit={submit}
      role="search"
    >
      <label htmlFor="patient-search-input">搜索病人</label>
      <div className="patient-search__controls">
        <input
          autoComplete="off"
          id="patient-search-input"
          name="patient-search"
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入病历号或姓名"
          value={value}
        />
        <button className="button button--primary" type="submit">
          搜索
        </button>
        <button
          className="button button--secondary"
          disabled={value.length === 0}
          onClick={clear}
          type="button"
        >
          清空搜索
        </button>
      </div>
    </form>
  )
}
