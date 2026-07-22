import { useCallback, useEffect, useRef, useState } from 'react'

import { getSeriesDetails, instanceImageId } from '../api/axialViewerApi'
import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { viewabilityReasonLabel } from '../../dicom-import/model/viewability'
import type { AxialSeriesStatus } from '../model/axialViewer'


function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useAxialSeries(seriesId: string) {
  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [imageIds, setImageIds] = useState<string[]>([])
  const [status, setStatus] = useState<AxialSeriesStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const activeController = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setDetail(null)
    setImageIds([])
    setStatus('loading')
    setError(null)

    try {
      const nextDetail = await getSeriesDetails(seriesId, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      if (nextDetail.viewability_status !== 'eligible') {
        throw new Error(
          `该序列暂不可查看：${viewabilityReasonLabel(nextDetail.viewability_reason)}`,
        )
      }
      if (nextDetail.instances.length === 0) {
        throw new Error('该序列没有可显示的影像实例')
      }
      setDetail(nextDetail)
      setImageIds(nextDetail.instances.map((instance) => instanceImageId(instance.id)))
      setStatus('success')
    } catch (requestError) {
      if (!controller.signal.aborted && !isAbortError(requestError)) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '无法加载轴位影像',
        )
        setStatus('error')
      }
    }
  }, [seriesId])

  useEffect(() => {
    void reload()
    return () => activeController.current?.abort()
  }, [reload])

  return { detail, imageIds, status, error, reload }
}
