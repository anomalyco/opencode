/** Local attachment-lifetime state. No provider trace, proof channel, or coverage claim crosses it. */
export type ScopeID = string

export type Current = {
  readonly scopeID: ScopeID
  readonly epoch: number
  readonly attached: number
  readonly undelivered: number
  readonly everAttached: boolean
  readonly candidate: boolean
  readonly failed: boolean
  readonly cancelled: boolean
  /**
   * This scope has already published its return-eligibility resolution.
   *
   * The gate is ONE-SHOT: it resolves once and latches. A scope outlives the run that resolved it —
   * R-23 requires an opened scope to stay live through its descendants — so a later, sequential run
   * on the same session can find a scope that has already spoken. Its resolution was computed for a
   * different turn and cannot speak for this one; a run that consumed it anyway would file at the
   * earlier turn position, hit the filing guard, and lose its own answer silently.
   *
   * Exposed because the Task boundary is what has to make that distinction. `locateBorrowable`
   * covers the scope that is already resolved at LOOKUP; this covers the scope that resolves while
   * a borrowed run is still in flight.
   */
  readonly resolved: boolean
}

export type Scope = {
  readonly id: ScopeID
  readonly current: () => Current
}

export * as AttachmentContract from "./contract"
