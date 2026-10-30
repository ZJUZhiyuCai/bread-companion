export type ErrorCode = 'INVALID_INPUT' | 'PERMISSION_DENIED' | 'UNSUPPORTED_MEDIA' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'TIMEOUT' | 'INVALID_MODEL_OUTPUT' | 'STALE_RESULT' | 'EVIDENCE_MISMATCH' | 'STORAGE_FAILED' | 'CANCELLED';
const messages: Record<ErrorCode, string> = {
  INVALID_INPUT: '输入格式或长度不合适，请检查后再试。', PERMISSION_DENIED: '当前请求不被允许。请从本机页面操作。', UNSUPPORTED_MEDIA: '这段音频的格式或大小暂不支持，可以继续打字。', PROVIDER_UNAVAILABLE: '服务暂时没有连接成功。你写的内容仍在，可以稍后重试或结束。', RATE_LIMITED: '请求有些频繁，请稍等片刻再试。', TIMEOUT: '这次处理超时了。可以手动重试，或先停在这里。', INVALID_MODEL_OUTPUT: '这次回复未通过内容检查，没有展示。可以补充材料后再试。', STALE_RESULT: '材料已经变化，这次结果已丢弃。', EVIDENCE_MISMATCH: '回复中的引用没有对应上材料，已拦截。请核对材料后重试。', STORAGE_FAILED: '没有保存成功。当前卡片还在，可以重试或导出。', CANCELLED: '本次操作已停止。'
};
export class AppError extends Error {
  constructor(public code: ErrorCode, public status = 400, public retryable = false) { super(messages[code]); }
}
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') return new AppError('CANCELLED', 499);
  if (error instanceof DOMException && error.name === 'TimeoutError') return new AppError('TIMEOUT', 504, true);
  return new AppError('PROVIDER_UNAVAILABLE', 502, true);
}
