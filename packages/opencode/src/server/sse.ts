import type { SSEStreamingApi } from "hono/streaming"

export function withHeartbeat(
  stream: SSEStreamingApi,
  sendHeartbeat: () => void | Promise<void>,
  onAbort?: () => void,
  options?: { interval?: number },
): Promise<void> {
  const interval = options?.interval ?? 10_000

  const heartbeat = setInterval(() => void Promise.resolve(sendHeartbeat()).catch(() => {}), interval)

  return new Promise<void>((resolve) => {
    stream.onAbort(() => {
      clearInterval(heartbeat)
      onAbort?.()
      resolve()
    })
  })
}
