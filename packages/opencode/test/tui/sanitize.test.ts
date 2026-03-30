import { describe, expect, test } from "bun:test"
import { sanitize } from "../../src/cli/cmd/tui/util/sanitize"

describe("sanitize", () => {
  test("returns text unchanged when no tags present", () => {
    expect(sanitize("Hello world")).toBe("Hello world")
  })

  test("returns empty string for empty input", () => {
    expect(sanitize("")).toBe("")
    expect(sanitize("   ")).toBe("")
  })

  test("strips system-reminder tags", () => {
    expect(sanitize("before <system-reminder>hidden</system-reminder> after")).toBe("before  after")
  })

  test("strips multiline system-reminder blocks", () => {
    const input = [
      "<system-reminder>",
      "[BACKGROUND TASK COMPLETED]",
      "**ID:** bg_123",
      "</system-reminder>",
      "Actual response",
    ].join("\n")
    expect(sanitize(input)).toBe("Actual response")
  })

  test("strips HTML comments with OMO_INTERNAL", () => {
    expect(sanitize("text <!-- OMO_INTERNAL_INITIATOR --> more text")).toBe("text  more text")
  })

  test("strips multiple different tag types in one string", () => {
    const input = [
      "<system-reminder>reminder content</system-reminder>",
      "<!-- OMO_INTERNAL_INITIATOR -->",
      "Visible content here",
    ].join("\n")
    expect(sanitize(input)).toBe("Visible content here")
  })

  test("strips multiple occurrences of the same tag", () => {
    const input = "<system-reminder>a</system-reminder> middle <system-reminder>b</system-reminder>"
    expect(sanitize(input)).toBe("middle")
  })

  test("preserves normal HTML that is not a known injected tag", () => {
    expect(sanitize("use <code>foo</code> here")).toBe("use <code>foo</code> here")
  })

  test("preserves normal HTML comments", () => {
    expect(sanitize("<!-- normal comment -->")).toBe("<!-- normal comment -->")
  })

  test("handles tags at start and end of string", () => {
    expect(sanitize("<system-reminder>x</system-reminder>")).toBe("")
  })

  test("handles only whitespace remaining after strip", () => {
    expect(sanitize("  <system-reminder>x</system-reminder>  ")).toBe("")
  })
})

describe("sanitize - dcp tags", () => {
  const dcpMsg = "<" + "dcp-message-id" + ">m1234</" + "dcp-message-id" + ">"
  const dcpSys = "<" + "dcp-system-reminder" + ">reminder</" + "dcp-system-reminder" + ">"

  test("strips dcp-message-id tags", () => {
    expect(sanitize("text " + dcpMsg + " more")).toBe("text  more")
  })

  test("strips dcp-system-reminder tags", () => {
    expect(sanitize("text " + dcpSys + " more")).toBe("text  more")
  })

  test("strips all dcp tags combined", () => {
    expect(sanitize(dcpMsg + " visible " + dcpSys)).toBe("visible")
  })
})
