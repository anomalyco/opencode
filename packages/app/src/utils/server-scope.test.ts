import { describe, expect, test } from "bun:test"
import { ScopedKey, ServerScope, SessionRouteKey, SessionStateKey, migrateLegacySessionStateKeys } from "./server-scope"

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

  test("extracts route keys from scoped and legacy state keys", () => {
    expect(String(SessionStateKey.route("cmVwbw/session-1"))).toBe("cmVwbw/session-1")
    expect(String(SessionStateKey.route("local\0cmVwbw/session-1"))).toBe("cmVwbw/session-1")
    expect(String(SessionStateKey.route("https://debian.example\0cmVwbw/session-1"))).toBe("cmVwbw/session-1")
  })
})

describe("migrateLegacySessionStateKeys", () => {
  test("copies legacy route keys into local scope without overwriting scoped state", () => {
    expect(
      migrateLegacySessionStateKeys({
        "cmVwbw/session-1": { active: "legacy" },
        "local\0cmVwbw/session-1": { active: "scoped" },
        "https://debian.example\0cmVwbw/session-1": { active: "remote" },
      }),
    ).toEqual({
      "local\0cmVwbw/session-1": { active: "scoped" },
      "https://debian.example\0cmVwbw/session-1": { active: "remote" },
    })
  })

  test("rejects invalid identity fragments", () => {
    expect(() => ScopedKey.from(ServerScope.local, "bad\0directory")).toThrow(
      "Scoped key part cannot contain null bytes",
    )
  })
})
