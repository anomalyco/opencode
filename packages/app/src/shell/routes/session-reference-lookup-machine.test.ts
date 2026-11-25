import type { SessionInfo } from "@opencode/client/promise"
import { describe, expect, test } from "bun:test"
import {
  createSessionReferenceLookupState,
  transitionSessionReferenceLookup,
  type SessionReferenceLookupEvent,
  type SessionReferenceLookupState,
} from "./session-reference-lookup-machine"

const ID = "ses_0123456789abcdefghijklmnop"

function info(archived?: number): SessionInfo {
  return {
    id: ID,
    projectID: "proj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    location: { directory: "/project" },
    title: "Linked",
    time: { created: 1, updated: 1, archived },
  }
}

function replay(events: readonly SessionReferenceLookupEvent[], state = createSessionReferenceLookupState()) {
  return events.reduce<SessionReferenceLookupState>(
    (current, event) => transitionSessionReferenceLookup(current, event).state,
    state,
  )
}

describe("transitionSessionReferenceLookup", () => {
  test("looks an unknown ID up once and remembers the session it finds", () => {
    const requested = transitionSessionReferenceLookup(createSessionReferenceLookupState(), {
      type: "requested",
      sessionID: ID,
    })

    expect(requested.effects).toEqual([{ type: "fetch", sessionID: ID, attempt: 1 }])

    // Markdown asks again on every render while the request runs, and after it settles.
    const repeated = transitionSessionReferenceLookup(requested.state, { type: "requested", sessionID: ID })
    expect(repeated.state).toBe(requested.state)
    expect(repeated.effects).toEqual([])

    const session = info()

    const resolved = transitionSessionReferenceLookup(requested.state, {
      type: "resolved",
      sessionID: ID,
      attempt: 1,
      session,
    })

    expect(resolved.effects).toEqual([{ type: "remember", session }])
    expect(transitionSessionReferenceLookup(resolved.state, { type: "requested", sessionID: ID }).effects).toEqual([])
  })

  test("a missing, failed or archived session is not asked for again and is not remembered", () => {
    const missing = transitionSessionReferenceLookup(replay([{ type: "requested", sessionID: ID }]), {
      type: "unavailable",
      sessionID: ID,
      attempt: 1,
    })

    expect(missing.effects).toEqual([])
    expect(transitionSessionReferenceLookup(missing.state, { type: "requested", sessionID: ID }).effects).toEqual([])

    const archived = transitionSessionReferenceLookup(replay([{ type: "requested", sessionID: ID }]), {
      type: "resolved",
      sessionID: ID,
      attempt: 1,
      session: info(5),
    })

    expect(archived.effects).toEqual([])
  })

  test("a server change aborts earlier lookups, ignores their answers and asks again", () => {
    const changed = transitionSessionReferenceLookup(replay([{ type: "requested", sessionID: ID }]), {
      type: "server.changed",
    })

    expect(changed.effects).toEqual([{ type: "abort-all" }])

    const stale = transitionSessionReferenceLookup(changed.state, {
      type: "resolved",
      sessionID: ID,
      attempt: 1,
      session: info(),
    })

    expect(stale.state).toBe(changed.state)
    expect(stale.effects).toEqual([])

    expect(transitionSessionReferenceLookup(changed.state, { type: "requested", sessionID: ID }).effects).toEqual([
      { type: "fetch", sessionID: ID, attempt: 2 },
    ])
  })

  test("disposing aborts lookups and ignores later answers", () => {
    const disposed = transitionSessionReferenceLookup(replay([{ type: "requested", sessionID: ID }]), {
      type: "disposed",
    })

    expect(disposed.effects).toEqual([{ type: "abort-all" }])
    expect(
      transitionSessionReferenceLookup(disposed.state, { type: "resolved", sessionID: ID, attempt: 1, session: info() })
        .effects,
    ).toEqual([])
  })
})
