import { useState } from 'react'

import type { ImportCategory, ImportReport as ImportReportModel } from '../model/dicomImport'


interface ImportReportProps {
  report: ImportReportModel
}

const CATEGORY_LABELS: Record<ImportCategory, string> = {
  success: '成功',
  duplicate: '重复',
  skipped: '跳过',
  unsupported: '不支持',
  failed: '失败',
}

export function ImportReport({ report }: ImportReportProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const nonSuccessItems = report.items.filter(
    (item) => item.category !== 'success',
  )

  return (
    <section aria-label="DICOM 导入报告" className="import-report">
      <div className="import-report__counts">
        <strong>成功 {report.success}</strong>
        <strong>重复 {report.duplicate}</strong>
        <strong>跳过 {report.skipped}</strong>
        <strong>不支持 {report.unsupported}</strong>
        <strong>失败 {report.failed}</strong>
      </div>
      <p>合计 {report.total} 个文件，五类计数一致。</p>
      {nonSuccessItems.length > 0 ? (
        <>
          <button
            aria-expanded={detailsOpen}
            className="button button--secondary"
            onClick={() => setDetailsOpen((value) => !value)}
            type="button"
          >
            {detailsOpen ? '收起非成功文件明细' : '查看非成功文件明细'}
          </button>
          {detailsOpen ? (
            <ul className="import-report__items">
              {nonSuccessItems.map((item, index) => (
                <li key={`${item.file_name}-${index}`}>
                  <strong>{item.file_name}</strong>
                  <span>{CATEGORY_LABELS[item.category]}</span>
                  <span>{item.message}</span>
                  <code>{item.code}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
