import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createImportJob,
  deleteImportJob,
  getImportJob,
  getLatestImportJob,
} from '../api/importJobApi'
import { buildImportManifest } from '../core/importManifest'
import { resumeImportUpload } from '../core/resumableUploader'
import type {
  ImportJob,
  ImportManifestFile,
  UploadProgress,
} from '../model/importJob'
import type { ImportReport } from '../model/dicomImport'


export type ImportJobPhase =
  | 'idle'
  | 'loading'
  | 'needs-selection'
  | 'uploading'
  | 'paused'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'

interface UseImportJobOptions {
  patientId: string
  open: boolean
  onImported: (report: ImportReport) => void
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function phaseForJob(job: ImportJob): ImportJobPhase {
  if (job.status === 'uploading') {
    return 'needs-selection'
  }
  return job.status
}

function progressForJob(job: ImportJob): UploadProgress {
  const firstIncomplete = job.files.findIndex(
    (file) => file.confirmed_offset < file.size_bytes,
  )
  return {
    uploadedBytes: job.uploaded_bytes,
    totalBytes: job.total_bytes,
    currentFile: firstIncomplete === -1 ? job.total_files : firstIncomplete + 1,
    totalFiles: job.total_files,
  }
}

export function useImportJob({
  patientId,
  open,
  onImported,
}: UseImportJobOptions) {
  const [job, setJobState] = useState<ImportJob | null>(null)
  const [phase, setPhase] = useState<ImportJobPhase>('idle')
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobRef = useRef<ImportJob | null>(null)
  const onImportedRef = useRef(onImported)
  const requestController = useRef<AbortController | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  const notifiedJobId = useRef<string | null>(null)
  onImportedRef.current = onImported

  const setJob = useCallback((next: ImportJob | null) => {
    jobRef.current = next
    setJobState(next)
    if (next === null) {
      setPhase('idle')
      setProgress(null)
      return
    }
    setPhase(phaseForJob(next))
    setProgress(progressForJob(next))
    if (next.status === 'completed' && next.report !== null) {
      if (notifiedJobId.current !== next.id) {
        notifiedJobId.current = next.id
        onImportedRef.current(next.report)
      }
    }
  }, [])

  const loadLatest = useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setPhase('loading')
    setError(null)
    try {
      const latest = await getLatestImportJob(patientId, controller.signal)
      if (!controller.signal.aborted) {
        setJob(latest)
      }
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法加载后台导入任务',
        )
        setPhase('idle')
      }
    }
  }, [patientId, setJob])

  const refresh = useCallback(async () => {
    const current = jobRef.current
    if (current === null) {
      await loadLatest()
      return
    }
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    try {
      const latest = await getImportJob(current.id, controller.signal)
      if (!controller.signal.aborted) {
        setError(null)
        setJob(latest)
      }
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法刷新后台导入任务',
        )
      }
    }
  }, [loadLatest, setJob])

  useEffect(() => {
    if (!open) {
      requestController.current?.abort()
      if (jobRef.current?.status === 'uploading') {
        uploadController.current?.abort()
        setPhase('paused')
      }
      return
    }
    void loadLatest()
    return () => requestController.current?.abort()
  }, [loadLatest, open])

  useEffect(() => {
    if (
      !open ||
      job === null ||
      (job.status !== 'queued' && job.status !== 'running')
    ) {
      return
    }
    let disposed = false
    const poll = async () => {
      if (disposed) {
        return
      }
      try {
        const latest = await getImportJob(job.id)
        if (!disposed) {
          setError(null)
          setJob(latest)
        }
      } catch (requestError) {
        if (!disposed && !isAbortError(requestError)) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : '无法刷新后台导入任务',
          )
        }
      }
    }
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [job, open, setJob])

  const prepareAndUpload = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) {
      setError('请选择至少一个 DICOM 文件或文件夹')
      return
    }
    uploadController.current?.abort()
    const controller = new AbortController()
    uploadController.current = controller
    setError(null)
    setPhase('uploading')
    try {
      let current = jobRef.current
      let manifest: readonly ImportManifestFile[] | undefined
      if (current === null || current.status === 'completed' || current.status === 'failed') {
        manifest = await buildImportManifest(files, controller.signal)
        current = await createImportJob(patientId, manifest, controller.signal)
        setJob(current)
      } else if (current.status === 'uploading') {
        current = await getImportJob(current.id, controller.signal)
        setJob(current)
      }
      if (current === null || current.status !== 'uploading') {
        setError('当前导入任务正在后台处理中，请稍候')
        setPhase(current === null ? 'idle' : phaseForJob(current))
        return
      }
      setPhase('uploading')
      const queued = await resumeImportUpload({
        job: current,
        files,
        ...(manifest === undefined ? {} : { manifest }),
        signal: controller.signal,
        onProgress: (nextProgress) => {
          setProgress(nextProgress)
        },
      })
      if (!controller.signal.aborted) {
        setJob(queued)
      }
    } catch (requestError) {
      if (controller.signal.aborted || isAbortError(requestError)) {
        if (jobRef.current?.status === 'uploading') {
          setPhase('paused')
        }
        return
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : '导入失败，请重试',
      )
      setPhase(
        jobRef.current?.status === 'uploading' ? 'needs-selection' : 'idle',
      )
    }
  }, [patientId, setJob])

  const discard = useCallback(async () => {
    const current = jobRef.current
    if (current === null) {
      return true
    }
    if (current.status === 'queued' || current.status === 'running') {
      setError('后台处理中不能放弃任务，请等待任务完成')
      return false
    }
    uploadController.current?.abort()
    const controller = new AbortController()
    try {
      await deleteImportJob(current.id, controller.signal)
      setJob(null)
      setError(null)
      return true
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '放弃导入失败，请重试',
      )
      return false
    }
  }, [setJob])

  const clearError = useCallback(() => setError(null), [])

  return {
    job,
    phase,
    progress,
    error,
    prepareAndUpload,
    discard,
    refresh,
    clearError,
  }
}
