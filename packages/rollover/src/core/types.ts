/** Core data contracts (spec Part A §3, §4.3, §4.4). Pure types — no harness imports allowed. */

export type Role = "user" | "assistant"

export interface NPart {
  type: "text" | "tool" | "other"
  /** text part */
  text?: string
  /** tool part */
  tool?: string
  callId?: string
  status?: "pending" | "running" | "completed" | "error"
  input?: unknown
  output?: string
  synthetic?: boolean
}

export interface NMessage {
  id: string
  role: Role
  parts: NPart[]
  createdAt: number
  synthetic?: boolean
}

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
}

// ── Ledger (spec §4.4) ────────────────────────────────────────────────────

export type RecordType = "objective" | "decision" | "user_correction" | "open_item" | "verification"

export interface LedgerProcess {
  command: string
  purpose: string
  onResult: string
}

export interface LedgerRecord {
  kind: "record"
  /** prefix + session-wide increasing counter: o1, d2, c3, i4, v5 */
  id: string
  type: RecordType
  /** <= 300 chars */
  text: string
  /** <= 200 chars */
  rationale?: string
  /** <= 5, repo-relative */
  files?: string[]
  /** verification only */
  status?: "pass" | "fail" | "partial"
  /** open_item only */
  process?: LedgerProcess
  epoch: number
  userMessageId: string
  turnMessageId: string
  createdAt: number
}

export interface LedgerInvalidation {
  kind: "invalidate"
  id: string
  reason: "superseded" | "resolved" | "duplicate"
  /** id of the invalidating record */
  by?: string
  at: number
}

export type LedgerLine = LedgerRecord | LedgerInvalidation

// ── Session state (spec §4.3) ─────────────────────────────────────────────

export interface RolloverRecord {
  epochAtSwap: number
  /** the real user message the new view starts at */
  cutoffMessageId: string
  /** ordered user/assistant message ids kept as readable tail */
  tailMessageIds: string[]
  /** frozen render */
  renderText: string
  /** last assistant reply before cutoff (<= 1500 chars) */
  lastReply: string
  appliedAt: number
  tokensBefore: number
  tokensAfter: number
}

export interface SessionSettings {
  thresholdTokens?: number
  tailN?: number
  /**
   * Per-session budget for the rendered <rollover_context> block. Written by
   * `/rollover --render <N>`; wins over every config layer for this session.
   */
  renderBudgetTokens?: number
  /**
   * Per-session opt-in switch (2026-11-17). true → the full auto pipeline
   * runs in this session; false → the session is fully off; absent → fall
   * back to the config layers (global → project → env), whose built-in
   * default is off. Written by `/rollover on|off` and by every settings
   * command (`<N>`, `-n`), which imply activation.
   */
  enabled?: boolean
}

export interface SessionState {
  v: 1
  sessionId: string
  /** written by /rollover commands */
  settings: SessionSettings
  /** starts at 0, +1 per swap */
  epoch: number
  extractedUntilMessageId: string | null
  lastContextTokens: number
  lastContextSource: "usage" | "estimate"
  lastContextAt: number
  /** active frozen view; reapplied on every transform */
  rollover: RolloverRecord | null
  /** last 50 user message ids a swap decision was already made for */
  decidedUserMessageIds: string[]
  consolidatedAtRecordCount: number
  touchedFiles: Record<string, { epoch: number; turn: number }>
  lastRollover?: {
    at: number
    before: number
    after: number
    epoch: number
    renderTokens?: number
    tailTokens?: number
  }
}

// ── Config (spec §4.1) ────────────────────────────────────────────────────

export type RolloverMode = "off" | "metrics_only" | "auto"

export interface RolloverConfig {
  /** metrics_only: measurement only, no extraction and no swap */
  mode: RolloverMode
  thresholdRatio: number
  thresholdCapTokens: number
  thresholdMinTokens: number
  /** null = compute */
  thresholdTokens: number | null
  tailN: number
  tailMaxN: number
  renderBudgetTokens: number
  /** "provider/model". null = small_model, else session model */
  extractionModel: string | null
  extractionDeltaMaxTokens: number
  extractionTimeoutMs: number
  consolidateAfterRecords: number
  consolidationTimeoutMs: number
  /**
   * Optional ledger enrichment (v2). true (default): extraction runs per idle
   * turn in the background and completed records enrich frozen renders.
   * false: swap-only pipeline, zero extraction calls.
   */
  ledger: boolean
  dataDir: string
}

// ── Metrics (spec Part B §4) ──────────────────────────────────────────────

export interface MetricEvent {
  ev: string
  ts: number
  sessionId: string
  epoch?: number
  [detail: string]: unknown
}
