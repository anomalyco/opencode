import { describe, expect, test } from "bun:test"
import { deviceAccess, deviceStep, requestAccess } from "./system-media"

describe("the system's camera and microphone setting", () => {
  test("macOS asks once, Windows only reports its switch, Linux has none", () => {
    expect(deviceAccess("darwin", "not-determined")).toBe("ask")
    expect(deviceAccess("darwin", "granted")).toBe("granted")
    expect(deviceAccess("darwin", "denied")).toBe("denied")
    expect(deviceAccess("darwin", "restricted")).toBe("denied")
    expect(deviceAccess("win32", "not-determined")).toBe("granted")
    expect(deviceAccess("win32", "denied")).toBe("denied")
    expect(deviceAccess("linux", "denied")).toBe("granted")
  })

  test("one refused device refuses a request, and one macOS has not asked about makes it ask", () => {
    expect(requestAccess(["granted", "ask"])).toBe("ask")
    expect(requestAccess(["ask", "denied"])).toBe("denied")
    expect(requestAccess([])).toBe("granted")
  })
})

describe("the next step of a camera or microphone request", () => {
  test("never reaches the system before the user's Allow", () => {
    for (const decision of [undefined, "allow", "block"] as const)
      expect(deviceStep({ system: "ask", decision, allowed: false })).not.toBe("ask-system")

    expect(deviceStep({ system: "ask", allowed: true })).toBe("ask-system")
  })

  test("asks the user while macOS has not asked, even for a site allowed before", () => {
    expect(deviceStep({ system: "ask", decision: "allow", allowed: false })).toBe("prompt")
    expect(deviceStep({ system: "ask", allowed: false })).toBe("prompt")
    expect(deviceStep({ system: "ask", decision: "block", allowed: false })).toBe("deny")
  })

  test("refuses at once what the system refuses, whatever the site's answer", () => {
    for (const decision of [undefined, "allow", "block"] as const)
      for (const allowed of [false, true]) expect(deviceStep({ system: "denied", decision, allowed })).toBe("refuse")
  })

  test("follows the site's answer once the system decided", () => {
    expect(deviceStep({ system: "granted", decision: "allow", allowed: false })).toBe("grant")
    expect(deviceStep({ system: "granted", allowed: false })).toBe("prompt")
    expect(deviceStep({ system: "granted", decision: "block", allowed: false })).toBe("deny")
    expect(deviceStep({ system: "granted", allowed: true })).toBe("grant")
  })
})
