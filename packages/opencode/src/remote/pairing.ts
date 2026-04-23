import type { PairResponse } from "@opencode-ai/relay/protocol"

export type PairResult = PairResponse

/**
 * Requests a fresh pairing code from the relay. The response is ephemeral
 * and not persisted — a new pairing is issued each time `opencode remote`
 * starts (and whenever the TTL elapses).
 */
export async function requestPairing(relayUrl: string): Promise<PairResult> {
  const url = joinUrl(relayUrl, "/pair")
  const res = await fetch(url, { method: "POST" })
  if (!res.ok) {
    throw new Error(`Relay refused pairing request: HTTP ${res.status}`)
  }
  return (await res.json()) as PairResult
}

function joinUrl(base: string, path: string): string {
  const url = new URL(base)
  url.pathname = (url.pathname.replace(/\/$/, "") + path).replace(/\/+/g, "/")
  return url.toString()
}
