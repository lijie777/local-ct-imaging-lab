import { useCallback, useEffect, useRef, useState } from 'react'

import { listPatients } from '../api/patientApi'
import type { Patient } from '../model/patient'


type PatientListStatus = 'loading' | 'success' | 'error'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '无法加载病人列表'
}

export function usePatientList() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [status, setStatus] = useState<PatientListStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const activeController = useRef<AbortController | null>(null)
  const activeQuery = useRef('')

  const runSearch = useCallback(async (nextQuery: string) => {
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    activeQuery.current = nextQuery
    setQuery(nextQuery)
    setStatus('loading')
    setError(null)

    try {
      const result = await listPatients(nextQuery, controller.signal)
      if (!controller.signal.aborted) {
        setPatients(result)
        setStatus('success')
      }
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setError(errorMessage(requestError))
        setStatus('error')
      }
    }
  }, [])

  const search = useCallback(
    (nextQuery: string) => runSearch(nextQuery.trim()),
    [runSearch],
  )

  const reload = useCallback(
    () => runSearch(activeQuery.current),
    [runSearch],
  )

  useEffect(() => {
    void runSearch('')
    return () => activeController.current?.abort()
  }, [runSearch])

  return { patients, status, error, query, reload, search }
}
