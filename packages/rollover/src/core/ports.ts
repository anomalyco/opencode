/** The core's only contact surface with the outside world (spec Part A §3). */
import type { LedgerLine, MetricEvent, SessionState, Usage } from "./types"

export interface LlmRequest {
  purpose: "extraction" | "consolidation"
  system: string
  user: string
  maxOutputTokens: number
  timeoutMs: number
  /** Optional "provider/model" override; falls back to the port's resolved model. */
  model?: string
}

export interface LlmResponse {
  text: string
  /**
   * null = the provider does not expose usage for this call (the
   * experimental.generate.text host returns text only). Never invented zeros.
   */
  usage: Usage | null
  costUsd?: number
  model: string
  latencyMs: number
}

export interface LlmPort {
  complete(req: LlmRequest): Promise<LlmResponse>
}

export interface StorePort {
  readState(sid: string): Promise<SessionState | null>
  writeState(sid: string, s: SessionState): Promise<void>
  appendLedger(sid: string, lines: LedgerLine[]): Promise<void>
  readLedger(sid: string): Promise<LedgerLine[]>
  appendMetric(sid: string, ev: MetricEvent): Promise<void>
}

export interface NotifyPort {
  toast(msg: string): Promise<void>
}
