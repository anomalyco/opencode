import { describe, expect, test } from "bun:test"
import type { ServerConnectionStatus } from "../client"
import {
  transitionConnectionSync,
  type ConnectionSyncEffect,
  type ConnectionSyncEvent,
  type ConnectionSyncState,
} from "./machine"

const status = (value: ServerConnectionStatus): ConnectionSyncEvent => ({ type: "status.changed", status: value })

const handshake: ConnectionSyncEvent = { type: "handshake.received" }

function replay(events: ConnectionSyncEvent[], state: ConnectionSyncState = { type: "idle" }) {
  return events.reduce<{ state: ConnectionSyncState; effects: ConnectionSyncEffect[] }>(
    (result, event) => {
      const next = transitionConnectionSync(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("transitionConnectionSync", () => {
  // The client sets `connected` when the handshake arrives but delivers the handshake on its next 16ms flush, so a
  // stream that drops inside that window delivers it after the client already reports `reconnecting`.
  test("does not sync on a handshake from a stream that dropped before it was delivered", () => {
    const dropped = replay([status("connecting"), status("connected"), status("reconnecting"), handshake])

    expect(dropped.effects).toEqual([{ type: "invalidate" }, { type: "invalidate" }])

    const next = replay([status("connected"), handshake], dropped.state)

    expect(next.effects).toEqual([{ type: "sync", reconnect: false }])
  })

  test("syncs once per connection in either order of status and handshake", () => {
    const result = replay([
      status("connecting"),
      status("connected"),
      handshake,
      status("reconnecting"),
      handshake,
      status("connected"),
      handshake,
    ])

    expect(result.effects).toEqual([
      { type: "invalidate" },
      { type: "sync", reconnect: false },
      { type: "invalidate" },
      { type: "sync", reconnect: true },
    ])
    expect(result.state).toEqual({ type: "live" })
  })

  test("invalidates once per disconnect", () => {
    const result = replay([status("connecting"), status("reconnecting"), status("connecting")])

    expect(result.effects).toEqual([{ type: "invalidate" }])
  })

  test("ignores every event once disposed", () => {
    const disposed = replay([status("connected"), { type: "disposed" }]).state

    for (const event of [status("reconnecting"), status("connected"), handshake]) {
      const result = transitionConnectionSync(disposed, event)
      expect(result.state).toBe(disposed)
      expect(result.effects).toEqual([])
    }
  })
})
