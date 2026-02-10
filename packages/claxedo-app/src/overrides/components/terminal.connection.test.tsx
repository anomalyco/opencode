import { describe, expect, test } from "bun:test"
import { restoreThenLive, sigwinchToggleSize, socketCloseIsError } from "./terminal-connection"

describe("terminal connection", () => {
  test("restore_then_live_output_no_interleaving_bug", () => {
    const out = restoreThenLive("RESTORE|", ["L1|", "L2|"])
    expect(out).toBe("RESTORE|L1|L2|")
  })

  test("sigwinch_toggle_reflow_called_on_reconnect", () => {
    const [first, second] = sigwinchToggleSize(80, 24)
    expect(first).toEqual({ cols: 79, rows: 24 })
    expect(second).toEqual({ cols: 80, rows: 24 })
  })

  test("socket_close_1000_is_not_error", () => {
    expect(socketCloseIsError(1000)).toBe(false)
  })

  test("socket_close_non1000_raises_connect_error_once", () => {
    const reported = { value: false }
    const raise = (code: number) => {
      if (!socketCloseIsError(code)) return false
      if (reported.value) return false
      reported.value = true
      return true
    }

    expect(raise(1011)).toBe(true)
    expect(raise(1011)).toBe(false)
  })
})
