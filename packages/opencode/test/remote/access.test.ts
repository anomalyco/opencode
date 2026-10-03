import { afterEach, describe, expect, test } from "bun:test"
import { RemoteAccess } from "@/remote/access"
import { SessionID } from "@/session/schema"

afterEach(() => RemoteAccess.resetForTest())

describe("RemoteAccess", () => {
  test("pairing tickets are one-use and create a session-scoped grant", () => {
    const session = SessionID.make("ses_remote_a")
    const other = SessionID.make("ses_remote_b")
    const pair = RemoteAccess.pair(session, 1_000)

    const grant = RemoteAccess.redeem(pair.ticket, 2_000)
    expect(grant?.sessionID).toBe(session)
    expect(RemoteAccess.redeem(pair.ticket, 2_000)).toBeUndefined()
    expect(RemoteAccess.authorized(grant!.token, session, 2_000)).toBe(true)
    expect(RemoteAccess.authorized(grant!.token, other, 2_000)).toBe(false)
  })

  test("new pairing invalidates the previous pending ticket for the same session", () => {
    const session = SessionID.make("ses_remote_pair_replace")
    const first = RemoteAccess.pair(session, 1_000)
    const second = RemoteAccess.pair(session, 2_000)

    expect(RemoteAccess.redeem(first.ticket, 3_000)).toBeUndefined()
    expect(RemoteAccess.redeem(second.ticket, 3_000)?.sessionID).toBe(session)
  })

  test("new grant invalidates the previous phone grant for the same session", () => {
    const session = SessionID.make("ses_remote_grant_replace")
    const first = RemoteAccess.redeem(RemoteAccess.pair(session, 1_000).ticket, 2_000)!
    const second = RemoteAccess.redeem(RemoteAccess.pair(session, 3_000).ticket, 4_000)!

    expect(RemoteAccess.authorized(first.token, session, 4_000)).toBe(false)
    expect(RemoteAccess.authorized(second.token, session, 4_000)).toBe(true)
  })

  test("expired pairing ticket is rejected", () => {
    const session = SessionID.make("ses_remote_expired")
    const pair = RemoteAccess.pair(session, 1_000)
    expect(RemoteAccess.redeem(pair.ticket, 1_000 + pair.expires_in * 1_000 + 1)).toBeUndefined()
  })

  test("revoke invalidates issued grants", () => {
    const session = SessionID.make("ses_remote_revoke")
    const pair = RemoteAccess.pair(session, 1_000)
    const grant = RemoteAccess.redeem(pair.ticket, 2_000)!

    RemoteAccess.revoke(session)
    expect(RemoteAccess.authorized(grant.token, session, 2_000)).toBe(false)
  })
})
