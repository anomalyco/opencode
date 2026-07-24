import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PtyID } from "@opencode-ai/core/pty/schema"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(PtyTicket.node))
const itExpiring = testEffect(
  LayerNode.compile(PtyTicket.node, [[PtyTicket.node, Layer.effect(PtyTicket.Service, PtyTicket.make(5))]]),
)

describe("PTY websocket tickets", () => {
  it.live("consumes tickets once", () =>
    Effect.gen(function* () {
      const tickets = yield* PtyTicket.Service
      const scope = { ptyID: PtyID.ascending(), directory: "/tmp/a" }
      const issued = yield* tickets.issue(scope)

      expect(yield* tickets.consume({ ...scope, ticket: issued.ticket })).toBe(true)
      expect(yield* tickets.consume({ ...scope, ticket: issued.ticket })).toBe(false)
    }),
  )

  it.live("rejects tickets scoped to a different request", () =>
    Effect.gen(function* () {
      const tickets = yield* PtyTicket.Service
      const ptyID = PtyID.ascending()
      const issued = yield* tickets.issue({ ptyID, directory: "/tmp/a" })

      expect(yield* tickets.consume({ ptyID, directory: "/tmp/b", ticket: issued.ticket })).toBe(false)
      expect(yield* tickets.consume({ ptyID, directory: "/tmp/a", ticket: issued.ticket })).toBe(true)
    }),
  )

  itExpiring.live("rejects tickets after the TTL elapses", () =>
    Effect.gen(function* () {
      const tickets = yield* PtyTicket.Service
      const ptyID = PtyID.ascending()
      const issued = yield* tickets.issue({ ptyID })

      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)))

      expect(yield* tickets.consume({ ptyID, ticket: issued.ticket })).toBe(false)
    }),
  )

  it.live("rejects tickets scoped to a different workspace", () =>
    Effect.gen(function* () {
      const tickets = yield* PtyTicket.Service
      const ptyID = PtyID.ascending()
      const workspaceID = WorkspaceV2.ID.ascending()
      const issued = yield* tickets.issue({ ptyID, workspaceID })

      expect(yield* tickets.consume({ ptyID, workspaceID: WorkspaceV2.ID.ascending(), ticket: issued.ticket })).toBe(
        false,
      )
      expect(yield* tickets.consume({ ptyID, workspaceID, ticket: issued.ticket })).toBe(true)
    }),
  )
})
