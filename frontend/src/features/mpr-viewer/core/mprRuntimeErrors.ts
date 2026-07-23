export const runtimeErrorMessage = '无法构建三视图，请重试或返回轴位查看器'

const runtimeErrorByStatus: Record<number, string> = {
  0: '无法连接本机服务，请确认服务已启动',
  404: '未找到该影像实例，请返回轴位查看器',
  409: '该序列暂不可查看，请返回轴位查看器',
  410: '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
  422: '影像请求无效，请返回轴位查看器',
  500: '本机影像服务异常，请重试或返回轴位查看器',
}

export function abortError(): DOMException {
  return new DOMException('MPR runtime creation cancelled', 'AbortError')
}

export function safeCall(action: () => void): void {
  try {
    action()
  } catch {
    // Resource cleanup is best-effort and must continue through later owners.
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const directStatus = (error as { status?: unknown }).status
  if (typeof directStatus === 'number') {
    return directStatus
  }
  const requestStatus = (error as { request?: { status?: unknown } }).request?.status
  return typeof requestStatus === 'number' ? requestStatus : undefined
}

export function toSafeRuntimeError(error: unknown): string {
  const status = errorStatus(error)
  return status === undefined
    ? runtimeErrorMessage
    : (runtimeErrorByStatus[status] ?? runtimeErrorByStatus[500])
}
