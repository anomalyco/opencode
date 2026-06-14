import { createSignal } from "solid-js"
import { fetchBitcostPricing, type BitcostPricing, type BitcostTask } from "./bitcost-api"

export type BitcostReportStatus = {
  attempts: number
  successes: number
  failures: number
  last: "success" | "failure"
}

// The TUI's `sync` session data uses the V1 session schema, which does not carry
// `bitcostTaskID`. This tracks which sessions have a bound Bitcost task in-process
// (set optimistically when the picker binds) so the prompt gate and startup gate
// don't have to round-trip on the hot path. Authoritative state lives in bitcost /
// the session row; hydrate via `sdk.client.v2.session.get` when the map misses.
//
// Reactive (Solid signals) so UI — e.g. the sidebar — updates when a task is
// bound or its details become known.
const [boundSessions, setBoundSessions] = createSignal<Record<string, string>>({})

// Known task details keyed by task id, populated whenever a task list is fetched
// (the picker, sidebar hydration). Lets us resolve a bound task's name/usage from
// just its id.
const [taskDetails, setTaskDetails] = createSignal<Record<string, BitcostTask>>({})
const [reportStatuses, setReportStatuses] = createSignal<Record<string, BitcostReportStatus>>({})

export function markBitcostBound(sessionID: string, taskID: string): void {
  setBoundSessions((prev) => (prev[sessionID] === taskID ? prev : { ...prev, [sessionID]: taskID }))
}

export function clearBitcostBound(sessionID: string): void {
  setBoundSessions((prev) => {
    if (!(sessionID in prev)) return prev
    const next = { ...prev }
    delete next[sessionID]
    return next
  })
}

export function bitcostBoundLocally(sessionID: string): boolean {
  return boundSessions()[sessionID] !== undefined
}

/** The task id bound to a session, if known in-process (reactive). */
export function bitcostBoundTaskID(sessionID: string): string | undefined {
  return boundSessions()[sessionID]
}

/** Remember details for fetched tasks so ids can be resolved to names later. */
export function rememberBitcostTasks(tasks: readonly BitcostTask[]): void {
  if (tasks.length === 0) return
  setTaskDetails((prev) => {
    const next = { ...prev }
    for (const task of tasks) next[String(task.id)] = task
    return next
  })
}

/** Details for a known task id, if previously fetched (reactive). */
export function bitcostTaskDetails(taskID: string): BitcostTask | undefined {
  return taskDetails()[taskID]
}

export function rememberBitcostReportStatus(sessionID: string, status: BitcostReportStatus): void {
  setReportStatuses((prev) => {
    const current = prev[sessionID]
    if (
      current?.attempts === status.attempts &&
      current?.successes === status.successes &&
      current?.failures === status.failures &&
      current?.last === status.last
    ) {
      return prev
    }
    return { ...prev, [sessionID]: status }
  })
}

export function bitcostReportStatus(sessionID: string): BitcostReportStatus | undefined {
  return reportStatuses()[sessionID]
}

// bitcost-authoritative per-1M-token rates, cached per provider/model/variant.
// A present value of `null` means "fetched, but bitcost has no pricing row".
const [pricing, setPricing] = createSignal<Record<string, BitcostPricing | null>>({})
const pricingInFlight = new Set<string>()

function pricingKey(provider: string, model: string, variant?: string): string {
  return `${provider}/${model}/${variant ?? ""}`
}

/** Cached rates for a model (reactive): undefined = not fetched, null = no pricing. */
export function bitcostPricing(provider: string, model: string, variant?: string): BitcostPricing | null | undefined {
  return pricing()[pricingKey(provider, model, variant)]
}

/** Fetch + cache a model's rates once (idempotent). Safe to call from an effect. */
export function ensureBitcostPricing(provider: string, model: string, variant?: string): void {
  const key = pricingKey(provider, model, variant)
  if (key in pricing() || pricingInFlight.has(key)) return
  pricingInFlight.add(key)
  void fetchBitcostPricing(provider, model, variant)
    .then((result) => setPricing((prev) => ({ ...prev, [key]: result })))
    .catch(() => setPricing((prev) => ({ ...prev, [key]: null })))
    .finally(() => pricingInFlight.delete(key))
}
