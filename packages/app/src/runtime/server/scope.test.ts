import { describe, expect, test } from "bun:test"
import { ScopedKey, ServerScope, SessionIdentityKey, SessionRouteKey, SessionStateKey } from "./scope"

describe("ServerScope", () => {
  test("uses a stable local scope for the canonical sidecar", () => {
    expect(String(ServerScope.fromServerKey("sidecar" as Parameters<typeof ServerScope.fromServerKey>[0]))).toBe(
      "local",
    )
  })

  test("keeps configured loopback servers distinct from the canonical sidecar", () => {
    expect(
      String(ServerScope.fromServerKey("http://localhost:4096" as Parameters<typeof ServerScope.fromServerKey>[0])),
    ).toBe("http://localhost:4096")
  })

  test("uses a stable local scope for an explicit canonical web server", () => {
    const key = "http://localhost:4096" as Parameters<typeof ServerScope.fromServerKey>[0]
    expect(String(ServerScope.fromServerKey(key, key))).toBe("local")
  })
})

describe("SessionIdentityKey", () => {
  test("stays stable when a session changes worktrees", () => {
    const before = SessionStateKey.from(ServerScope.local, SessionRouteKey.fromRoute("b2xk", "session-1"))
    const after = SessionStateKey.from(ServerScope.local, SessionRouteKey.fromRoute("bmV3", "session-1"))

    expect(SessionIdentityKey.fromState(before)).toBe(SessionIdentityKey.fromState(after))
    expect(String(SessionIdentityKey.fromState(before))).toBe("local\0session-1")
  })

  test("keeps sessions and servers distinct", () => {
    const first = SessionStateKey.from(ServerScope.local, SessionRouteKey.fromRoute("cmVwbw", "session-1"))
    const second = SessionStateKey.from(ServerScope.local, SessionRouteKey.fromRoute("cmVwbw", "session-2"))
    const remote = SessionStateKey.from(
      "https://remote.example" as ServerScope,
      SessionRouteKey.fromRoute("cmVwbw", "session-1"),
    )

    expect(SessionIdentityKey.fromState(first)).not.toBe(SessionIdentityKey.fromState(second))
    expect(SessionIdentityKey.fromState(first)).not.toBe(SessionIdentityKey.fromState(remote))
  })
})

describe("SessionStateKey", () => {
  test("combines local and remote scope with route identity", () => {
    const route = SessionRouteKey.fromRoute("cmVwbw", "session-1")
    expect(String(SessionStateKey.from(ServerScope.local, route))).toBe("local\0cmVwbw/session-1")
    expect(String(SessionStateKey.from("https://windows.example" as ServerScope, route))).toBe(
      "https://windows.example\0cmVwbw/session-1",
    )
    expect(SessionStateKey.from("https://debian.example" as ServerScope, route)).not.toBe(
      SessionStateKey.from("https://windows.example" as ServerScope, route),
    )
  })

  test("extracts route keys from scoped state keys", () => {
    expect(String(SessionStateKey.route("local\0cmVwbw/session-1"))).toBe("cmVwbw/session-1")
    expect(String(SessionStateKey.route("https://debian.example\0cmVwbw/session-1"))).toBe("cmVwbw/session-1")
  })

  test("rejects unscoped state keys", () => {
    expect(SessionStateKey.is("cmVwbw/session-1")).toBe(false)
    expect(SessionStateKey.is("local\0cmVwbw/session-1")).toBe(true)
    expect(() => SessionStateKey.route("cmVwbw/session-1")).toThrow("Session state key must include server scope")
    expect(() => SessionStateKey.scope("cmVwbw/session-1")).toThrow("Session state key must include server scope")
  })

  test("rejects invalid identity fragments", () => {
    expect(() => ScopedKey.from(ServerScope.local, "bad\0directory")).toThrow(
      "Scoped key part cannot contain null bytes",
    )
  })
})
