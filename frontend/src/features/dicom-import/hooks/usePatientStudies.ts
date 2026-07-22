import { useCallback, useEffect, useRef, useState } from 'react'

import {
  listPatientStudies,
  listStudySeries,
} from '../api/dicomImportApi'
import type { Series, Study } from '../model/dicomImport'


export type PatientStudiesStatus = 'idle' | 'loading' | 'success' | 'error'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function usePatientStudies(patientId: string | null) {
  const [studies, setStudies] = useState<Study[]>([])
  const [seriesByStudy, setSeriesByStudy] = useState<Record<string, Series[]>>({})
  const [status, setStatus] = useState<PatientStudiesStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    activeController.current?.abort()
    if (patientId === null) {
      setStudies([])
      setSeriesByStudy({})
      setStatus('idle')
      setError(null)
      return
    }

    const controller = new AbortController()
    activeController.current = controller
    setStudies([])
    setSeriesByStudy({})
    setStatus('loading')
    setError(null)

    try {
      const nextStudies = await listPatientStudies(patientId, controller.signal)
      const seriesEntries = await Promise.all(
        nextStudies.map(async (study) => [
          study.id,
          await listStudySeries(study.id, controller.signal),
        ] as const),
      )
      if (!controller.signal.aborted) {
        setStudies(nextStudies)
        setSeriesByStudy(Object.fromEntries(seriesEntries))
        setStatus('success')
      }
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法加载影像检查',
        )
        setStatus('error')
      }
    }
  }, [patientId])

  useEffect(() => {
    void reload()
    return () => activeController.current?.abort()
  }, [reload])

  return { studies, seriesByStudy, status, error, reload }
}
