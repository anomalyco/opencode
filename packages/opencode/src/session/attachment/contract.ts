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
}

export type Scope = {
  readonly id: ScopeID
  readonly current: () => Current
}

export * as AttachmentContract from "./contract"
