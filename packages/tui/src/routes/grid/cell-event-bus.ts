import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createSimpleContext } from "../../context/helper"
import { useSDK } from "../../context/sdk"
import type { WorkspaceID } from "../../context/workspace-clients"

/**
 * Per-cell event routing layer. The TUI now keeps the SDK SSE connection in
 * a single place (`sdk.event`) so the network cost of N workspace streams is
 * paid once. Cells subscribe here instead of opening their own SSE streams;
 * the bus fans each envelope out to every cell whose workspaceID matches the
 * event's `workspace` field.
 *
 * Routing rules:
 *   - `event.directory === "global"` — broadcast to every subscriber.
 *   - `event.workspace === subscriber.workspaceID` — deliver to that subscriber.
 *   - everything else — dropped (cells in workspace A don't see workspace B's
 *     traffic).
 *
 * Deduplication: the SSE upstream can re-deliver the same envelope (reconnect
 * replays the tail, or two cells sharing a workspace would otherwise process
 * the same payload twice if they each opened a stream). The bus maintains a
 * small recent-id cache so a duplicate event delivered in quick succession
 * is delivered to the *first* matching subscriber and silently dropped for
 * later ones within the dedup window. The cache key is the event's payload
 * type plus a content fingerprint (`type|propertiesHash`) so two semantically
 * identical `message.updated` events collapse to one delivery.
 */

export type CellEventEnvelope = GlobalEvent

export type CellEventSubscription = {
  /**
   * Workspace this subscription belongs to. `undefined` means the subscriber
   * is the "default" (no-workspace) cell and only receives global envelopes.
   */
  workspaceID: WorkspaceID | undefined
  /** Handler invoked for every routed event. */
  handler: (event: CellEventEnvelope) => void
}

export type CellEventBusState = {
  /** Subscribe a cell to the routed event stream. */
  subscribe: (sub: CellEventSubscription) => () => void
  /** Convenience helper: subscribe filtered to a specific event type. */
  on: <T extends CellEventEnvelope["payload"]["type"]>(
    workspaceID: WorkspaceID | undefined,
    type: T,
    handler: (event: Extract<CellEventEnvelope["payload"], { type: T }>) => void,
  ) => () => void
  /** Snapshot of currently active subscribers. Useful for tests/diagnostics. */
  subscribers: () => CellEventSubscription[]
  /** Drop every cached envelope. Used on full reconnect / flush. */
  reset: () => void
}

const DEDUP_LIMIT = 256

const fingerprint = (event: GlobalEvent): string => {
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion) -- payload is a discriminated union, we treat it as a record for stable fingerprinting
  const payload = event.payload as unknown as Record<string, unknown> & { type: string }
  // Normalize across the two payload shapes: most events carry a `properties`
  // bag, while `sync.*` events carry a `data` bag. Fall back to the entire
  // payload JSON when neither is present so the key is still stable.
  // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion)
  const fields =
    (payload.properties as Record<string, unknown> | undefined) ??
    // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion)
    (payload.data as Record<string, unknown> | undefined) ??
    payload
  const sorted = JSON.stringify(fields, Object.keys(fields).sort())
  return `${payload.type}|${sorted}`
}

export const { use: useCellEventBus, provider: CellEventBusProvider } = createSimpleContext({
  name: "CellEventBus",
  init: (): CellEventBusState => {
    const sdk = useSDK()
    const emitter = createGlobalEmitter<{ event: CellEventEnvelope }>()
    const subs = new Set<CellEventSubscription>()
    // Fingerprint LRU — Map preserves insertion order, so we evict the oldest
    // entry by deleting + re-inserting on touch.
    const recent = new Map<string, true>()

    const remember = (key: string) => {
      if (recent.has(key)) return false
      recent.set(key, true)
      if (recent.size > DEDUP_LIMIT) {
        const oldest = recent.keys().next().value
        if (oldest !== undefined) recent.delete(oldest)
      }
      return true
    }

    // Pump every envelope from the SDK stream into the bus exactly once. The
    // SDK already coalesces per-frame (batched flush), so we just hand the
    // payload to the local routing layer below.
    sdk.event.on("event", (envelope) => {
      const key = fingerprint(envelope)
      if (!remember(key)) return
      emitter.emit("event", envelope)
    })

    // Local emitter → fanout to per-cell subscribers. The Solid emitter does
    // not dedup across listeners, but we still want every cell in workspace A
    // to receive workspace-A events — so we broadcast at this layer and let
    // the upstream `sdk.event` source be the single network attachment.
    const ROUTE = (envelope: CellEventEnvelope): void => {
      const isGlobal = envelope.directory === "global"
      for (const sub of subs) {
        if (isGlobal) {
          sub.handler(envelope)
          continue
        }
        if (sub.workspaceID !== undefined && envelope.workspace === sub.workspaceID) {
          sub.handler(envelope)
        }
      }
    }
    emitter.on("event", ROUTE)

    return {
      subscribe(sub: CellEventSubscription) {
        subs.add(sub)
        return () => {
          subs.delete(sub)
        }
      },
      on(workspaceID, type, handler) {
        return this.subscribe({
          workspaceID,
          handler: (event) => {
            if (event.payload.type !== type) return
            // Runtime guard above; TS can't propagate the narrowing into the
            // generic `handler` parameter across this closure, so we cast.
            // oxlint-disable-next-line typescript-eslint(no-unsafe-type-assertion)
            handler(event.payload as never)
          },
        })
      },
      subscribers() {
        return [...subs]
      },
      reset() {
        recent.clear()
      },
    }
  },
})
