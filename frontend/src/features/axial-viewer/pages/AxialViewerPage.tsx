import { useState } from 'react'

import { AppShell } from '../../../app/AppShell'
import { Advanced3dViewerPage } from '../../advanced-3d-viewer/pages/Advanced3dViewerPage'
import { MprViewerPage } from '../../mpr-viewer/pages/MprViewerPage'
import { deriveMprEligibility } from '../../mpr-viewer/model/mprViewer'
import { AxialViewport } from '../components/AxialViewport'
import { useAxialSeries } from '../hooks/useAxialSeries'
import type { AxialViewerContext } from '../model/axialViewer'


interface AxialViewerPageProps {
  context: AxialViewerContext
  onClose: () => void
}

export function AxialViewerPage({ context, onClose }: AxialViewerPageProps) {
  const [advanced3dOpen, setAdvanced3dOpen] = useState(false)
  const [mprOpen, setMprOpen] = useState(false)
  const series = useAxialSeries(context.series.id)
  const mprEligibility = series.status === 'success' && series.detail !== null
    ? deriveMprEligibility(series.detail)
    : null

  if (advanced3dOpen) {
    return (
      <Advanced3dViewerPage
        context={context}
        onClose={() => setAdvanced3dOpen(false)}
      />
    )
  }

  if (mprOpen) {
    return (
      <MprViewerPage
        context={context}
        onClose={() => setMprOpen(false)}
      />
    )
  }

  return (
    <AppShell>
      <section className="axial-viewer-page">
        <header className="axial-viewer-heading">
          <div>
            <p className="eyebrow">本机 CT 轴位查看</p>
            <h1>轴位查看器</h1>
            <p>仅供教学演示，请勿用于诊断或治疗决策。</p>
          </div>
          <button
            className="button button--secondary"
            onClick={onClose}
            type="button"
          >
            返回病人管理
          </button>
        </header>

        <dl className="viewer-context">
          <div><dt>病人</dt><dd>{context.patient.name}</dd></div>
          <div><dt>病历号</dt><dd>{context.patient.medical_record_no}</dd></div>
          <div><dt>检查</dt><dd>{context.study.description ?? '未命名 CT 检查'}</dd></div>
          <div><dt>检查日期</dt><dd>{context.study.study_date ?? '未知'}</dd></div>
          <div><dt>序列</dt><dd>{context.series.description ?? '未命名 CT 序列'}</dd></div>
          <div><dt>实例数</dt><dd>{context.series.instance_count}</dd></div>
        </dl>

        {series.status === 'loading' ? (
          <p className="viewer-message">正在加载轴位影像…</p>
        ) : null}
        {series.status === 'error' ? (
          <div className="viewer-message viewer-message--error" role="alert">
            <p>{series.error ?? '无法加载轴位影像'}</p>
            <button
              className="button button--secondary"
              onClick={() => void series.reload()}
              type="button"
            >
              重试
            </button>
          </div>
        ) : null}
        {series.status === 'success' ? (
          <>
            <AxialViewport
              imageIds={series.imageIds}
              seriesId={context.series.id}
            />
            {mprEligibility?.eligible ? (
              <div className="mpr-entry">
                <p>该序列具备三视图重建所需的多位置空间信息。</p>
                <button
                  className="button button--primary"
                  onClick={() => setMprOpen(true)}
                  type="button"
                >
                  进入三视图
                </button>
              </div>
            ) : null}
            {mprEligibility?.eligible ? (
              <div className="advanced-3d-entry">
                <p>该序列具备高级 3D 所需的多位置空间信息。</p>
                <button
                  className="button button--primary"
                  onClick={() => setAdvanced3dOpen(true)}
                  type="button"
                >
                  进入高级 3D
                </button>
              </div>
            ) : null}
            {mprEligibility !== null && !mprEligibility.eligible ? (
              <div className="mpr-entry mpr-entry--unavailable">
                <p>{`三视图暂不可用：${mprEligibility.reason ?? '查看条件不足'}`}</p>
                <button
                  className="button button--secondary"
                  disabled
                  type="button"
                >
                  三视图暂不可用
                </button>
              </div>
            ) : null}
            {mprEligibility !== null && !mprEligibility.eligible ? (
              <div className="advanced-3d-entry advanced-3d-entry--unavailable">
                <p>{`高级 3D 暂不可用：${mprEligibility.reason ?? '查看条件不足'}`}</p>
                <button
                  className="button button--secondary"
                  disabled
                  type="button"
                >
                  高级 3D 暂不可用
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </AppShell>
  )
}
