export * as ReadRange from "./read-range.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { SessionStore } from "../session/store.js"
import { Permission } from "../permission.js"

export interface Range {
  readonly path: string
  readonly version: string
  readonly totalLines: number
}

/** A configured policy stop, distinct from an actual user declining a request. */
export class BlockedError extends ToolFailure {}

const isRange = Schema.is(Schema.Struct({ path: Schema.String, version: Schema.String, totalLines: Schema.Number }))
export const isGate = (metadata: Tool.Metadata) => metadata.readRangeGate === true && isRange(metadata.readRange)

export const make = Effect.gen(function* () {
  const store = yield* SessionStore.Service
  const permission = yield* Permission.Service

  return Effect.fn("ReadRange.check")(function* (range: Range, context: Tool.Context) {
    // Failure settlement snapshots progress even if the permission request is cancelled or declined.
    yield* context.progress({ readRange: range })
    const current = yield* store.messageWithRefs(context.messageID)
    if (!current || current.sessionID !== context.sessionID) return
    let messages = [current.message]
    let cursor = context.messageID
    let failures = 0
    // Read canonical projections without hydrating media, including settled calls in this response.
    // Page back to the promoted user boundary rather than imposing a fixed detection horizon.
    while (failures < 2) {
      for (const message of messages) {
        if (message.type === "user") return
        if (message.type !== "assistant") continue
        failures += message.content.filter((part) => {
          if (part.type !== "tool" || part.state.status !== "error") return false
          const previous = part.state.metadata?.readRange
          return (
            isRange(previous) &&
            previous.path === range.path &&
            previous.version === range.version &&
            previous.totalLines === range.totalLines
          )
        }).length
        if (failures >= 2) break
      }
      if (failures >= 2) break
      messages = yield* store
        .messagesWithRefs({
          sessionID: context.sessionID,
          order: "desc",
          limit: 16,
          cursor: { id: cursor, direction: "next" },
        })
        .pipe(Effect.orDie)
      const oldest = messages.at(-1)
      if (!oldest) return
      cursor = oldest.id
    }
    // Only completed failures count; calls already running in parallel may finish before a later call is gated.
    yield* context.progress({ readRange: range, readRangeGate: true })
    yield* permission
      .assert({
        action: "doom_loop",
        resources: ["read"],
        save: ["read"],
        metadata: { tool: "read", readRange: range },
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })
      .pipe(
        Effect.catchTag("Permission.BlockedError", (error) =>
          Effect.fail(
            new BlockedError({
              message: `Repeated out-of-range reads stopped by doom_loop permission: ${range.path}`,
              error,
              metadata: { readRange: range, readRangeBlocked: true },
            }),
          ),
        ),
        Effect.catchTag("Permission.CorrectedError", (error) =>
          Effect.fail(new ToolFailure({ message: error.message, error, metadata: { readRange: range } })),
        ),
      )
  })
})
