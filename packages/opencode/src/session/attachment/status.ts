import type { ModelMessage } from "ai"
import { ASYNC_TASK_STATUS } from "@/tool/task-protocol"

/**
 * A request-local observation, not a delivery proof.
 *
 * Once at least one attachment existed, zero live jobs and zero terminal outcomes awaiting a
 * successful parent prompt are enough to offer the model the status line. This observation does not
 * prove that transcript selection retained the parent prompt or that the status survives provider
 * lowering; a missed or early status costs only another wait decision and never changes attachment
 * settlement.
 */
export function observe(input: {
  readonly everAttached: boolean
  readonly attached: number
  readonly undelivered: number
  readonly failed: boolean
  readonly cancelled: boolean
}): boolean {
  return input.everAttached && input.attached === 0 && input.undelivered === 0 && !input.failed && !input.cancelled
}

/** Request-local user suffix, appended to the outgoing request only. It is never persisted. */
export function suffix(observed: boolean): ModelMessage[] | undefined {
  if (!observed) return undefined
  return [{ role: "user" as const, content: [{ type: "text", text: ASYNC_TASK_STATUS }] }]
}

export * as AttachmentStatus from "./status"
