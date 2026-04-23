/**
 * Wire protocol shared between the relay, the opencode CLI tunnel client, and
 * any remote clients that speak directly to the broker. Type-only; no runtime
 * code so it stays cheap to import from both sides.
 */

export const PAIR_CODE_LENGTH = 8
export const PAIR_CODE_TTL_MS = 5 * 60 * 1000
export const TUNNEL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const CLIENT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

export type TunnelFrame =
  | {
      id: string
      type: "http_request"
      method: string
      path: string
      headers: Record<string, string>
      body?: string
      bodyEncoding?: "utf8" | "base64"
    }
  | {
      id: string
      type: "http_response_head"
      status: number
      headers: Record<string, string>
    }
  | {
      id: string
      type: "http_chunk"
      data: string
      encoding: "utf8" | "base64"
    }
  | {
      id: string
      type: "http_end"
    }
  | {
      id: string
      type: "http_error"
      message: string
    }
  | {
      id: string
      type: "abort"
    }
  | {
      type: "ping"
    }
  | {
      type: "pong"
    }

export type PairResponse = {
  code: string
  tunnelToken: string
  expiresAt: number
  claimUrl: string
}

export type ClaimRequest = {
  code: string
}

export type ClaimResponse = {
  clientToken: string
  expiresAt: number
  sessionHint?: string
}
