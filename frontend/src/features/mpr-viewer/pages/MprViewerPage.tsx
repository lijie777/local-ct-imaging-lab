import { AppShell } from '../../../app/AppShell'
import type { AxialViewerContext } from '../../axial-viewer/model/axialViewer'
import { MprViewportGrid } from '../components/MprViewportGrid'
import { useMprSeries } from '../hooks/useMprSeries'


interface MprViewerPageProps {
  context: AxialViewerContext
  onClose: () => void
}

export function MprViewerPage({ context, onClose }: MprViewerPageProps) {
  const series = useMprSeries(context.series.id)
  const canRetry = series.errorKind === 'service' ||
    series.errorKind === 'persistence' ||
    series.errorKind === 'unknown'

  return (
    <AppShell>
      <section className="mpr-viewer-page">
        <header className="mpr-viewer-heading">
          <div>
            <p className="eyebrow">本机 CT 三视图</p>
            <h1>CT 三视图</h1>
            <p>仅供教学演示，请勿用于诊断或治疗决策。</p>
          </div>
          <button
            className="button button--secondary"
            onClick={onClose}
            type="button"
          >
            返回轴位查看器
          </button>
        </header>

        {series.status === 'loading' ? (
          <p className="viewer-message">正在校验三视图数据…</p>
        ) : null}
        {series.status === 'error' ? (
          <div className="viewer-message viewer-message--error" role="alert">
            <p>{series.error ?? '无法加载三视图，请返回轴位查看器'}</p>
            {canRetry ? (
              <button
                className="button button--secondary"
                onClick={() => void series.reload()}
                type="button"
              >
                重试三视图
              </button>
            ) : null}
          </div>
        ) : null}
        {series.status === 'success' &&
        series.detail !== null &&
        series.eligibility?.eligible ? (
          <MprViewportGrid
            imageIds={series.imageIds}
            seriesId={context.series.id}
            metadata={(
              <>
                <h2>影像摘要</h2>
                <dl className="mpr-metadata-list">
                  <div><dt>病人</dt><dd>{context.patient.name}</dd></div>
                  <div><dt>病历号</dt><dd>{context.patient.medical_record_no}</dd></div>
                  <div><dt>检查</dt><dd>{context.study.description ?? '未命名 CT 检查'}</dd></div>
                  <div><dt>检查日期</dt><dd>{context.study.study_date ?? '未知'}</dd></div>
                  <div><dt>序列</dt><dd>{series.detail.description ?? '未命名 CT 序列'}</dd></div>
                  <div><dt>Modality</dt><dd>{series.detail.modality}</dd></div>
                  <div>
                    <dt>Rows × Columns</dt>
                    <dd>{`${series.detail.rows} × ${series.detail.columns}`}</dd>
                  </div>
                  <div><dt>实例数</dt><dd>{series.detail.instance_count}</dd></div>
                  <div>
                    <dt>切片间距</dt>
                    <dd>{series.eligibility.sliceSpacing === null
                      ? '不可推导'
                      : `${series.eligibility.sliceSpacing.toFixed(1)} mm`}</dd>
                  </div>
                </dl>
              </>
            )}
          />
        ) : null}
      </section>
    </AppShell>
  )
}
