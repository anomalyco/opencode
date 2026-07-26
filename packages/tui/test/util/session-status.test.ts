import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { resolveStatus, statusDisplay, type StatusTheme } from "../../src/util/session-status"

const theme: StatusTheme = {
  primary: RGBA.fromHex("#fab283"),
  warning: RGBA.fromHex("#f5a742"),
  error: RGBA.fromHex("#ff0000"),
  success: RGBA.fromHex("#7fd88f"),
  textMuted: RGBA.fromHex("#808080"),
  background: RGBA.fromHex("#000000"),
}

const MINUTE = 60_000
const boot = Date.now()

describe("resolveStatus", () => {
  test("prefers runtime signals over the persisted row", () => {
    expect(
      resolveStatus({ pendingInput: true, runtime: "busy", persisted: { status: "done", time: { created: 0, updated: 0 } }, bootTime: boot }),
    ).toBe("needs_input")
    expect(resolveStatus({ runtime: "retry", persisted: { status: "done", time: { created: 0, updated: 0 } }, bootTime: boot })).toBe(
      "retrying",
    )
    expect(resolveStatus({ runtime: "busy", bootTime: boot })).toBe("working")
  })

  test("reads needs_input and done from the persisted row", () => {
    expect(resolveStatus({ persisted: { status: "needs_input", time: { created: 0, updated: 0 } }, bootTime: boot })).toBe(
      "needs_input",
    )
    expect(resolveStatus({ persisted: { status: "done", time: { created: 0, updated: 0 } }, bootTime: boot })).toBe("done")
  })

  test("derives interrupted for active statuses older than this process", () => {
    const stale = { status: "working" as const, time: { created: 0, updated: boot - 1000 } }
    expect(resolveStatus({ persisted: stale, bootTime: boot })).toBe("interrupted")
    const fresh = { status: "working" as const, time: { created: 0, updated: boot + 1000 } }
    expect(resolveStatus({ persisted: fresh, bootTime: boot })).toBe("working")
  })

  test("shows nothing for idle or missing rows", () => {
    expect(resolveStatus({ bootTime: boot })).toBeUndefined()
    expect(resolveStatus({ persisted: { status: "idle", time: { created: 0, updated: 0 } }, bootTime: boot })).toBeUndefined()
  })
})

describe("statusDisplay", () => {
  test("needs input starts warning, fades, then mutes but never disappears", () => {
    expect(statusDisplay("needs_input", boot, boot + 1 * MINUTE, theme)?.color).toBe(theme.warning)
    const faded = statusDisplay("needs_input", boot, boot + 30 * MINUTE, theme)
    expect(faded?.label).toBe("Needs input")
    expect(faded?.color).not.toBe(theme.warning)
    expect(faded?.color).not.toBe(theme.textMuted)
    expect(statusDisplay("needs_input", boot, boot + 5 * 60 * MINUTE, theme)?.color).toBe(theme.textMuted)
  })

  test("retrying stays error regardless of age", () => {
    expect(statusDisplay("retrying", boot, boot + 90 * MINUTE, theme)?.color).toBe(theme.error)
  })

  test("working mutes after an hour", () => {
    expect(statusDisplay("working", boot, boot + 30 * MINUTE, theme)?.color).toBe(theme.primary)
    expect(statusDisplay("working", boot, boot + 90 * MINUTE, theme)?.color).toBe(theme.textMuted)
  })

  test("done starts success, fades, then expires", () => {
    expect(statusDisplay("done", boot, boot + 1 * MINUTE, theme)?.color).toBe(theme.success)
    expect(statusDisplay("done", boot, boot + 10 * MINUTE, theme)?.color).not.toBe(theme.success)
    expect(statusDisplay("done", boot, boot + 31 * MINUTE, theme)).toBeUndefined()
  })

  test("interrupted is always muted", () => {
    expect(statusDisplay("interrupted", boot, boot, theme)?.color).toBe(theme.textMuted)
  })
})
