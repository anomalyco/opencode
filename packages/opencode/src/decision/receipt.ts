export type Verb = "commit" | "push"
export type State = "committed" | "pushed" | "blocked" | "needs_confirm" | "rejected"

export type Target = {
  kind: string
  id?: string
}

export type Receipt = {
  id: string
  ts: string
  verb: Verb
  action: string
  target?: Target
  commit_id?: string
  dry_run: boolean
  state: State
  adverse: boolean
  reason?: string
  meta?: Record<string, unknown>
  source?: string
}

export const ADVERSE_ACTIONS = new Set(["reject", "offer", "hire"])

const SECRET_KEY =
  /^(?:.*(?:token|secret|password|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key).*)$/i

export function isAdverse(action: string): boolean {
  return ADVERSE_ACTIONS.has(action.trim().toLowerCase())
}

export function scrubMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) continue
        nested[k] = v
      }
      out[key] = nested
      continue
    }
    out[key] = value
  }
  if (Object.keys(out).length === 0) return undefined
  return out
}

export * as DecisionReceipt from "./receipt"
