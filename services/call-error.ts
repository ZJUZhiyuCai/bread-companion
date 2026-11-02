/** Service failures belong to a turn. Permission and quota failures require an explicit reconnect. */
export class CallServiceError extends Error {
  constructor(message: string, readonly requiresReconnect = false) { super(message); }
}

export function callServiceError(error: unknown, status = 502): CallServiceError {
  const data = error && typeof error === 'object' ? error as { code?: unknown; userMessage?: unknown; retryable?: unknown } : {};
  const message = typeof data.userMessage === 'string' ? data.userMessage.slice(0, 400) : '这次声音连接暂时没接上。';
  return new CallServiceError(message, [401, 403, 429].includes(status)
    || ['PERMISSION_DENIED', 'RATE_LIMITED'].includes(String(data.code)));
}
