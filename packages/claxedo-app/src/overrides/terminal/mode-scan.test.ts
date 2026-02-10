import { describe, expect, test } from "bun:test"
import { createModeScanner } from "./mode-scan"

describe("mode scan", () => {
  test("mode_scan_bracketed_paste_enable_split_chunks", () => {
    const scan = createModeScanner()
    scan.scan("start\u001b[?20")
    const value = scan.scan("04h-end")
    expect(value).toBe(true)
    expect(scan.bracketed()).toBe(true)
  })

  test("mode_scan_bracketed_paste_disable_split_chunks", () => {
    const scan = createModeScanner()
    scan.scan("\u001b[?2004h")
    scan.scan("x\u001b[?20")
    const value = scan.scan("04l")
    expect(value).toBe(false)
    expect(scan.bracketed()).toBe(false)
  })

  test("mode_scan_mixed_data_and_escape_tail", () => {
    const scan = createModeScanner()
    scan.scan("abc\u001b[?2004hdef")
    scan.scan("ghi\u001b[?2")
    expect(scan.bracketed()).toBe(true)
    expect(scan.tail()).toBe("\u001b[?2")
  })

  test("mode_scan_malformed_sequence_does_not_stick_state", () => {
    const scan = createModeScanner()
    scan.scan("\u001b[?2004h")
    scan.scan("oops\u001b[?2004x")
    expect(scan.bracketed()).toBe(true)
    expect(scan.tail()).toBe("")
    scan.scan("\u001b[?2004l")
    expect(scan.bracketed()).toBe(false)
  })
})
