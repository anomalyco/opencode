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
      resolveStatus({
        pendingInput: true,
        runtime: "busy",
        persisted: { status: "done", time: { created: 0, updated: 0 } },
      }),
    ).toBe("needs_input")
    expect(
      resolveStatus({
        runtime: "retry",
        persisted: { status: "done", time: { created: 0, updated: 0 } },
      }),
    ).toBe("retrying")
    expect(resolveStatus({ runtime: "busy" })).toBe("working")
  })

  test("reads needs_input and done from the persisted row", () => {
    expect(resolveStatus({ persisted: { status: "needs_input", time: { created: 0, updated: 0 } } })).toBe(
      "needs_input",
    )
    expect(resolveStatus({ persisted: { status: "done", time: { created: 0, updated: 0 } } })).toBe("done")
  })

  test("trusts the persisted row, including server-derived interrupted", () => {
    expect(resolveStatus({ persisted: { status: "working", time: { created: 0, updated: 0 } } })).toBe("working")
    expect(resolveStatus({ persisted: { status: "retrying", time: { created: 0, updated: 0 } } })).toBe("retrying")
    expect(resolveStatus({ persisted: { status: "interrupted", time: { created: 0, updated: 0 } } })).toBe(
      "interrupted",
    )
    expect(resolveStatus({ persisted: { status: "waiting", time: { created: 0, updated: 0 } } })).toBe("waiting")
  })

  test("shows nothing for idle or missing rows", () => {
    expect(resolveStatus({})).toBeUndefined()
    expect(resolveStatus({ persisted: { status: "idle", time: { created: 0, updated: 0 } } })).toBeUndefined()
  })
})

describe("statusDisplay", () => {
  test("needs input starts warning, fades in the warm band, then mutes", () => {
    expect(statusDisplay("needs_input", boot, boot + 1 * MINUTE, theme)?.color).toBe(theme.warning)
    const warm = statusDisplay("needs_input", boot, boot + 30 * MINUTE, theme)
    expect(warm?.label).toBe("Needs input")
    expect(warm?.icon).toBe("!")
    expect(warm?.color).not.toBe(theme.warning)
    expect(warm?.color).not.toBe(theme.textMuted)
    expect(statusDisplay("needs_input", boot, boot + 90 * MINUTE, theme)?.color).toBe(theme.textMuted)
  })

  test("waiting ages like needs input but reads as a question", () => {
    const fresh = statusDisplay("waiting", boot, boot + 1 * MINUTE, theme)
    expect(fresh?.label).toBe("Waiting")
    expect(fresh?.icon).toBe("?")
    expect(fresh?.color).toBe(theme.warning)
    expect(statusDisplay("waiting", boot, boot + 90 * MINUTE, theme)?.color).toBe(theme.textMuted)
  })

  test("retrying stays error regardless of age", () => {
    const display = statusDisplay("retrying", boot, boot + 90 * MINUTE, theme)
    expect(display?.color).toBe(theme.error)
    expect(display?.icon).toBe("⚠")
  })

  test("working mutes after an hour and keeps the spinner", () => {
    expect(statusDisplay("working", boot, boot + 30 * MINUTE, theme)?.color).toBe(theme.primary)
    expect(statusDisplay("working", boot, boot + 90 * MINUTE, theme)?.color).toBe(theme.textMuted)
    expect(statusDisplay("working", boot, boot + 1 * MINUTE, theme)?.icon).toBeUndefined()
  })

  test("done starts success, fades, then expires", () => {
    expect(statusDisplay("done", boot, boot + 1 * MINUTE, theme)?.color).toBe(theme.success)
    expect(statusDisplay("done", boot, boot + 1 * MINUTE, theme)?.icon).toBe("✓")
    expect(statusDisplay("done", boot, boot + 10 * MINUTE, theme)?.color).not.toBe(theme.success)
    expect(statusDisplay("done", boot, boot + 31 * MINUTE, theme)).toBeUndefined()
  })

  test("interrupted is always muted", () => {
    const display = statusDisplay("interrupted", boot, boot, theme)
    expect(display?.color).toBe(theme.textMuted)
    expect(display?.icon).toBe("✕")
  })
})
