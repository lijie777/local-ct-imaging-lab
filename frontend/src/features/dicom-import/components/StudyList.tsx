import type { Series, Study } from '../model/dicomImport'
import type { PatientStudiesStatus } from '../hooks/usePatientStudies'
import { viewabilityReasonLabel } from '../model/viewability'


interface StudyListProps {
  error: string | null
  onOpenSeries: (study: Study, series: Series) => void
  onRetry: () => void
  seriesByStudy: Record<string, Series[]>
  status: PatientStudiesStatus
  studies: Study[]
}

function viewabilityLabel(series: Series): string {
  return series.viewability_status === 'eligible'
    ? '可供后续查看'
    : `暂不可查看：${viewabilityReasonLabel(series.viewability_reason)}`
}

export function StudyList({
  error,
  onOpenSeries,
  onRetry,
  seriesByStudy,
  status,
  studies,
}: StudyListProps) {
  if (status === 'idle') {
    return null
  }

  return (
    <section aria-label="影像检查" className="study-list-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本机 DICOM 索引</p>
          <h2>影像检查</h2>
        </div>
      </div>
      {status === 'loading' ? <p>正在加载影像检查…</p> : null}
      {status === 'error' ? (
        <div className="study-list__error" role="alert">
          <p>{error ?? '无法加载影像检查'}</p>
          <button className="button button--secondary" onClick={onRetry} type="button">
            重试
          </button>
        </div>
      ) : null}
      {status === 'success' && studies.length === 0 ? (
        <p>暂无影像检查，可使用“导入 DICOM”添加本机 CT 数据。</p>
      ) : null}
      {status === 'success' && studies.length > 0 ? (
        <ol className="study-list">
          {studies.map((study) => (
            <li className="study-card" key={study.id}>
              <div>
                <h3>{study.description ?? '未命名 CT 检查'}</h3>
                <p>
                  检查日期：{study.study_date ?? '未知'} · {study.series_count} 个序列 ·
                  {' '}{study.instance_count} 个影像实例
                </p>
              </div>
              <ul className="series-list">
                {(seriesByStudy[study.id] ?? []).map((series) => (
                  <li key={series.id}>
                    <strong>{series.description ?? `CT 序列 ${series.series_number ?? '未知'}`}</strong>
                    <span>{series.instance_count} 个实例</span>
                    <span>{viewabilityLabel(series)}</span>
                    {series.viewability_status === 'eligible' ? (
                      <button
                        className="button button--secondary"
                        onClick={() => onOpenSeries(study, series)}
                        type="button"
                      >
                        打开轴位查看器
                      </button>
                    ) : (
                      <button
                        className="button button--secondary"
                        disabled
                        type="button"
                      >
                        暂不可查看
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
