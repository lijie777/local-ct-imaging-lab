import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { instanceImageId } from '../../axial-viewer/api/axialViewerApi'
import {
  DicomApiError,
  getSeriesDetails,
} from '../../dicom-import/api/dicomImportApi'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import {
  deriveMprEligibility,
  type MprErrorKind,
  type MprSeriesStatus,
} from '../model/mprViewer'


interface SafeMprError {
  kind: MprErrorKind
  message: string
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function safeRequestError(error: unknown): SafeMprError {
  if (!(error instanceof DicomApiError)) {
    return {
      kind: 'unknown',
      message: '无法加载三视图，请重试或返回轴位查看器',
    }
  }
  if (error.code === 'series_not_found' || error.status === 404) {
    return {
      kind: 'notFound',
      message: '未找到该本机 CT 序列，请返回轴位查看器',
    }
  }
  if (error.code === 'series_not_viewable' || error.status === 409) {
    return {
      kind: 'notViewable',
      message: '该序列暂不可查看，请返回轴位查看器',
    }
  }
  if (error.code === 'validation_error' || error.status === 422) {
    return {
      kind: 'validation',
      message: '影像请求无效，请返回轴位查看器',
    }
  }
  if (error.code === 'persistence_error') {
    return {
      kind: 'persistence',
      message: '本机影像数据暂时不可用，请重试或返回轴位查看器',
    }
  }
  if (error.code === 'network_error' || error.status === null || error.status >= 500) {
    return {
      kind: 'service',
      message: error.status === null
        ? '无法连接本机服务，请确认服务已启动'
        : '本机影像服务异常，请重试或返回轴位查看器',
    }
  }
  return {
    kind: 'unknown',
    message: '无法加载三视图，请重试或返回轴位查看器',
  }
}

export function useMprSeries(seriesId: string) {
  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [imageIds, setImageIds] = useState<string[]>([])
  const [status, setStatus] = useState<MprSeriesStatus>('idle')
  const [errorKind, setErrorKind] = useState<MprErrorKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  const loadSeries = useCallback(async (requestedSeriesId: string) => {
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setDetail(null)
    setImageIds([])
    setStatus('loading')
    setErrorKind(null)
    setError(null)

    try {
      const nextDetail = await getSeriesDetails(requestedSeriesId, controller.signal)
      if (controller.signal.aborted || activeController.current !== controller) {
        return
      }
      const nextEligibility = deriveMprEligibility(nextDetail)
      setDetail(nextDetail)
      if (!nextEligibility.eligible) {
        const notViewable = nextDetail.viewability_status !== 'eligible' ||
          nextDetail.modality !== 'CT'
        setErrorKind(notViewable ? 'notViewable' : 'geometry')
        setError(notViewable
          ? '该序列暂不可查看，请返回轴位查看器'
          : `三视图暂不可用：${nextEligibility.reason ?? '查看条件不足'}`)
        setStatus('error')
        return
      }
      setImageIds(nextDetail.instances.map((instance) => instanceImageId(instance.id)))
      setStatus('success')
    } catch (requestError) {
      if (
        controller.signal.aborted ||
        activeController.current !== controller ||
        isAbortError(requestError)
      ) {
        return
      }
      const safeError = safeRequestError(requestError)
      setErrorKind(safeError.kind)
      setError(safeError.message)
      setStatus('error')
    }
  }, [])

  const reload = useCallback(
    () => loadSeries(seriesId),
    [loadSeries, seriesId],
  )

  useEffect(() => {
    void loadSeries(seriesId)
    return () => activeController.current?.abort()
  }, [loadSeries, seriesId])

  const eligibility = useMemo(
    () => detail === null ? null : deriveMprEligibility(detail),
    [detail],
  )

  return { detail, imageIds, eligibility, status, errorKind, error, reload }
}
