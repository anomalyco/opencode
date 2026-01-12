import { describe, expect, mock, test } from "bun:test"
import { resolvePastedContent } from "../../../src/cli/cmd/tui/component/prompt/paste"

describe("resolvePastedContent", () => {
  test("returns normalized event text when present", async () => {
    const readClipboard = mock(async () => undefined)
    const result = await resolvePastedContent("  Hello\r\nWorld  ", readClipboard)
    expect(result).toBe("Hello\nWorld")
    expect(readClipboard.mock.calls.length).toBe(0)
  })

  test("falls back to clipboard text when event text is empty", async () => {
    const readClipboard = mock(async () => ({ data: "  clipboard text  ", mime: "text/plain" }))
    const result = await resolvePastedContent("", readClipboard)
    expect(result).toBe("clipboard text")
    expect(readClipboard.mock.calls.length).toBe(1)
  })

  test("returns undefined when clipboard lacks text content", async () => {
    const readClipboard = mock(async () => ({ data: "ignored", mime: "image/png" }))
    const result = await resolvePastedContent("", readClipboard)
    expect(result).toBeUndefined()
  })
})
