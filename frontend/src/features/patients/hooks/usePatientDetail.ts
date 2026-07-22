import { useCallback, useEffect, useRef, useState } from 'react'

import { getPatient } from '../api/patientApi'
import type { Patient } from '../model/patient'


type PatientDetailStatus = 'idle' | 'loading' | 'success' | 'error'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function usePatientDetail(patientId: string | null) {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [status, setStatus] = useState<PatientDetailStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    activeController.current?.abort()
    if (patientId === null) {
      setPatient(null)
      setStatus('idle')
      setError(null)
      return
    }

    const controller = new AbortController()
    activeController.current = controller
    setStatus('loading')
    setError(null)

    try {
      const result = await getPatient(patientId, controller.signal)
      if (!controller.signal.aborted) {
        setPatient(result)
        setStatus('success')
      }
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setPatient(null)
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法加载病人详情',
        )
        setStatus('error')
      }
    }
  }, [patientId])

  useEffect(() => {
    void reload()
    return () => activeController.current?.abort()
  }, [reload])

  return { patient, status, error, reload }
}
