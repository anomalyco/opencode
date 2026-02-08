import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export type ServerHealth = { healthy: boolean; version?: string }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

function timeoutSignal(timeoutMs: number) {
  return (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout?.(timeoutMs)
}

export async function checkServerHealth(
  url: string,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  const signal = opts?.signal ?? timeoutSignal(opts?.timeoutMs ?? 3000)
  const sdk = createOpencodeClient({
    baseUrl: url,
    fetch,
    signal,
  })
  return sdk.global
    .health()
    .then((x) => ({ healthy: x.data?.healthy === true, version: x.data?.version }))
    .catch(() => ({ healthy: false }))
}
