// Presence status and its derivation, in a leaf module with no imports.
//
// It lived in presence.ts, which imports Loop for its schema. `session/peers.ts`
// needs the same derivation and is itself imported BY the loop, so going
// through presence.ts closed a cycle at module-init time —
// `Cannot access 'defaultLayer' before initialization`, which surfaces as every
// loop test erroring before it runs rather than as a compile error.
//
// The loop shape here is structural (`{ status }`) rather than `Loop.Info` on
// purpose: that is all the derivation reads, and depending on the whole type
// would re-close the cycle.
import { Schema } from "effect"

export const Status = Schema.Literals(["idle", "busy", "awaiting-permission", "cancelling", "stalled", "unreachable"])
export type Status = Schema.Schema.Type<typeof Status>

export function statusFrom(input: {
  session: { type: string } | undefined
  permissionPending: boolean
  loop?: { status: string }
}): Status {
  if (input.permissionPending) return "awaiting-permission"
  if (input.loop?.status === "stalled") return "stalled"
  if (input.loop?.status === "cancelled") return "cancelling"
  if (input.session?.type === "busy" || input.session?.type === "retry") return "busy"
  return "idle"
}
