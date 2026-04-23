/**
 * Upper bound on the SSE producer queue. When exceeded, the stream is assumed
 * to be wedged (e.g. TCP in CLOSE_WAIT where Hono's `onAbort` never fires) and
 * the caller is expected to close it. Sized to allow bursty traffic while
 * still catching genuine stalls within seconds.
 */
export const MAX_QUEUE_SIZE = 10_000

/**
 * Max time an individual `writeSSE` is allowed to sit pending before the
 * stream is considered dead. On a healthy connection each write completes in
 * milliseconds; this exists to break out of half-closed sockets where the
 * write neither resolves nor rejects.
 */
export const WRITE_TIMEOUT_MS = 30_000

type SSEStream = {
  writeSSE: (input: { data: string }) => Promise<void>
}

export function writeSSEWithTimeout(stream: SSEStream, data: string, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    stream.writeSSE({ data }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("sse write timeout")), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
