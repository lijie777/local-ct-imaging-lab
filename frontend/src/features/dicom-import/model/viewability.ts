const viewabilityReasonLabels: Record<string, string> = {
  inconsistent_dimensions: '同一序列的图像尺寸不一致',
  inconsistent_orientation: '同一序列的图像方向不一致',
  missing_dimensions: 'DICOM 缺少图像尺寸',
  missing_geometry: 'DICOM 缺少空间位置或方向信息',
  missing_pixel_data: 'DICOM 缺少像素数据',
  unsupported_transfer_syntax: '当前版本不支持该传输语法',
}


export function viewabilityReasonLabel(reason: string | null): string {
  return reason !== null && Object.hasOwn(viewabilityReasonLabels, reason)
    ? viewabilityReasonLabels[reason]
    : '查看条件不足'
}
