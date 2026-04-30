import { describe, expect, test } from "bun:test"

// Import from the pure-helpers module so this test does not pull in
// Electron at runtime. (`./telemetry` imports `electron`, which `bun test`
// can't load outside the Electron host process.)
import { isAllowedEvent, pickUpdateStrategy } from "./telemetry-strategy"

describe("pickUpdateStrategy", () => {
  test("Linux always uses electron-updater auto", () => {
    expect(pickUpdateStrategy("linux", false)).toBe("linux-auto")
    // Even if the (impossible) isStore flag is true on Linux, Linux auto wins
    // — windowsStore is meaningful only on win32.
    expect(pickUpdateStrategy("linux", true)).toBe("linux-auto")
  })

  test("macOS uses manual update check", () => {
    expect(pickUpdateStrategy("darwin", false)).toBe("manual")
  })

  test("Windows non-store uses manual update check", () => {
    expect(pickUpdateStrategy("win32", false)).toBe("manual")
  })

  test("Windows MS Store skips update check", () => {
    expect(pickUpdateStrategy("win32", true)).toBe("store-skip")
  })

  test("unknown platforms fall back to manual", () => {
    expect(pickUpdateStrategy("freebsd", false)).toBe("manual")
    expect(pickUpdateStrategy("openbsd", false)).toBe("manual")
    expect(pickUpdateStrategy("aix" as NodeJS.Platform, false)).toBe("manual")
  })

  test("isStore=true outside win32 does not trigger store-skip", () => {
    // windowsStore is only meaningful on Windows; if some other platform
    // happens to surface a truthy value we should ignore it.
    expect(pickUpdateStrategy("darwin", true)).toBe("manual")
  })
})

describe("isAllowedEvent", () => {
  test("accepts the five core desktop events", () => {
    expect(isAllowedEvent("desktop.app_open")).toBe(true)
    expect(isAllowedEvent("desktop.project_open")).toBe(true)
    expect(isAllowedEvent("desktop.ai_request")).toBe(true)
    expect(isAllowedEvent("desktop.update_downloaded")).toBe(true)
    expect(isAllowedEvent("desktop.update_applied")).toBe(true)
  })

  test("accepts the optional desktop.update_seen", () => {
    expect(isAllowedEvent("desktop.update_seen")).toBe(true)
  })

  test("rejects anything outside the whitelist (privacy guard)", () => {
    expect(isAllowedEvent("desktop.ai_request_with_prompt")).toBe(false)
    expect(isAllowedEvent("cli.session_start")).toBe(false)
    expect(isAllowedEvent("user.email")).toBe(false)
    expect(isAllowedEvent("")).toBe(false)
    // Even the SDK's own pageview name should not bypass — heartbeat goes
    // through client.heartbeat(), not through trackEvent.
    expect(isAllowedEvent("pageview")).toBe(false)
  })
})
