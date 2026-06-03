import { describe, expect, test } from "bun:test"
import { ToolCallLeak } from "../../src/session/tool-call-leak"

describe("ToolCallLeak.detect", () => {
  test("fires on the captured malformed Qwen3 sample (issue #24316)", () => {
    // Real leak captured from vLLM + Qwen3.6-27B-NVFP4: model drifted to
    // `<function_bash>`, vLLM's parser consumed the opening <tool_call> and
    // flushed the rest as text.
    const text =
      "\n\n<function_bash>\n<parameter=command>\nfind lib -name \"*.dart\" | head -20\n</parameter>\n</function>\n</tool_call>"
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("fires on a well-formed Qwen3 XML block", () => {
    const text =
      "<tool_call>\n<function=read>\n<parameter=filePath>\n/tmp/index.js\n</parameter>\n</function>\n</tool_call>"
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("fires on a closed hermes JSON block", () => {
    const text = '<tool_call>\n{"name": "read", "arguments": {"filePath": "/tmp/a"}}\n</tool_call>'
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("fires on a truncated hermes block with trailing whitespace", () => {
    const text = 'Let me check that file.\n<tool_call>\n{"name": "read"\n  '
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("fires on an unclosed tool_call block in XML style", () => {
    const text = "<tool_call>\n<function=read>\n<parameter=filePath>\n/tmp/a"
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("ignores a bare opener truncated before any closing tag (documented limitation)", () => {
    const text = "<function_bash>\n<parameter=command>\nfind . -name '*.dart'"
    expect(ToolCallLeak.detect(text)).toBe(false)
  })

  test("fires when prose precedes the leaked block", () => {
    const text =
      "I'll search the codebase for the handler.\n\n<function=grep>\n<parameter=pattern>\nhandler\n</parameter>\n</function>"
    expect(ToolCallLeak.detect(text)).toBe(true)
  })

  test("ignores plain prose", () => {
    expect(ToolCallLeak.detect("The refactor is complete. All tests pass.")).toBe(false)
  })

  test("ignores mid-text tag mentions that end in prose", () => {
    const text = "Use `<parameter=filePath>` to pass the path. The closing `</parameter>` tag is required."
    expect(ToolCallLeak.detect(text)).toBe(false)
  })

  test("ignores closing tags without any opening signature", () => {
    expect(ToolCallLeak.detect("In XML, elements end with tags like </function>")).toBe(false)
  })

  test("ignores empty text", () => {
    expect(ToolCallLeak.detect("")).toBe(false)
  })

  test("exports the integration contract", () => {
    expect(ToolCallLeak.MAX_ATTEMPTS).toBeGreaterThan(0)
    expect(ToolCallLeak.MARKER).toBe("toolCallLeakRecovery")
    expect(ToolCallLeak.NUDGE.length).toBeGreaterThan(0)
  })
})

const nudgePart = {
  type: "text",
  synthetic: true,
  metadata: { [ToolCallLeak.MARKER]: true },
}
const user = (...parts: any[]) => ({ info: { role: "user" }, parts })
const assistant = (...parts: any[]) => ({ info: { role: "assistant" }, parts })
const textPart = (text: string) => ({ type: "text", text })

describe("ToolCallLeak.countAttempts", () => {
  test("zero when the last user message is a real prompt", () => {
    const msgs = [user(textPart("fix the bug")), assistant(textPart("ok"))]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(0)
  })

  test("counts trailing nudge messages", () => {
    const msgs = [
      user(textPart("fix the bug")),
      assistant(textPart("<tool_call>")),
      user(nudgePart),
      assistant(textPart("<tool_call>")),
      user(nudgePart),
      assistant(textPart("<tool_call>")),
    ]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(2)
  })

  test("resets after a real user prompt", () => {
    const msgs = [
      user(textPart("fix the bug")),
      assistant(textPart("<tool_call>")),
      user(nudgePart),
      assistant(textPart("done")),
      user(textPart("now add tests")),
      assistant(textPart("<tool_call>")),
    ]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(0)
  })

  test("a synthetic part without the marker is not a nudge", () => {
    const msgs = [user({ type: "text", synthetic: true })]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(0)
  })

  test("a file-only user message is real input and resets the count", () => {
    const msgs = [
      user(textPart("fix the bug")),
      assistant(textPart("<tool_call>")),
      user(nudgePart),
      assistant(textPart("<tool_call>")),
      user({ type: "file", url: "data:image/png;base64,x" }),
      assistant(textPart("<tool_call>")),
    ]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(0)
  })

  test("a message mixing a nudge part with real text is real input", () => {
    const msgs = [user(nudgePart, textPart("also, look at this"))]
    expect(ToolCallLeak.countAttempts(msgs)).toBe(0)
  })

  test("empty history", () => {
    expect(ToolCallLeak.countAttempts([])).toBe(0)
  })
})

describe("ToolCallLeak.isNudge", () => {
  test("accepts the exact nudge shape", () => {
    expect(ToolCallLeak.isNudge(nudgePart)).toBe(true)
  })

  test("rejects parts missing any of type/synthetic/marker", () => {
    expect(ToolCallLeak.isNudge({ type: "file", synthetic: true, metadata: { [ToolCallLeak.MARKER]: true } })).toBe(false)
    expect(ToolCallLeak.isNudge({ type: "text", metadata: { [ToolCallLeak.MARKER]: true } })).toBe(false)
    expect(ToolCallLeak.isNudge({ type: "text", synthetic: true })).toBe(false)
  })
})
