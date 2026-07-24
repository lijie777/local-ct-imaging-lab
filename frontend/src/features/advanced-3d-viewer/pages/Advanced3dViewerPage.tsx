import { AppShell } from '../../../app/AppShell'
import type { AxialViewerContext } from '../../axial-viewer/model/axialViewer'
import { Advanced3dViewport } from '../components/Advanced3dViewport'
import { useAdvanced3dSeries } from '../hooks/useAdvanced3dSeries'


interface Advanced3dViewerPageProps {
  context: AxialViewerContext
  onClose: () => void
}

export function Advanced3dViewerPage({
  context,
  onClose,
}: Advanced3dViewerPageProps) {
  const series = useAdvanced3dSeries(context.series.id)
  const canRetry = series.errorKind === 'service' ||
    series.errorKind === 'persistence' ||
    series.errorKind === 'unknown'

  return (
    <AppShell>
      <section className="advanced-3d-viewer-page">
        <header className="advanced-3d-viewer-heading">
          <div>
            <p className="eyebrow">本机 CT 三维可视化</p>
            <h1>CT 高级 3D</h1>
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
          <p className="viewer-message">正在校验高级 3D 数据…</p>
        ) : null}
        {series.status === 'error' ? (
          <div className="viewer-message viewer-message--error" role="alert">
            <p>{series.error ?? '无法加载高级 3D，请返回轴位查看器'}</p>
            {canRetry ? (
              <button
                className="button button--secondary"
                onClick={() => void series.reload()}
                type="button"
              >
                重试高级 3D
              </button>
            ) : null}
          </div>
        ) : null}
        {series.status === 'success' &&
        series.detail !== null &&
        series.eligibility?.eligible ? (
          <Advanced3dViewport
            imageIds={series.imageIds}
            metadata={(
              <>
                <h2>影像摘要</h2>
                <dl className="advanced-3d-metadata-list">
                  <div><dt>Patient</dt><dd>{context.patient.name}</dd></div>
                  <div><dt>病历号</dt><dd>{context.patient.medical_record_no}</dd></div>
                  <div><dt>Study</dt><dd>{context.study.description ?? '未命名 CT 检查'}</dd></div>
                  <div><dt>日期</dt><dd>{context.study.study_date ?? '未知'}</dd></div>
                  <div><dt>Series</dt><dd>{series.detail.description ?? '未命名 CT 序列'}</dd></div>
                  <div><dt>Modality</dt><dd>{series.detail.modality}</dd></div>
                  <div>
                    <dt>Rows × Columns</dt>
                    <dd>{`${series.detail.rows ?? '未知'} × ${series.detail.columns ?? '未知'}`}</dd>
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
            onRetry={() => series.reload()}
          />
        ) : null}
      </section>
    </AppShell>
  )
}
