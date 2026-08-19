import { describe, expect, test } from "bun:test"
import type { Part, TextPart } from "@opencode-ai/sdk/v2"
import { splitUserMessageText } from "../../src/routes/session/user-message-text"

function textPart(text: string, extra: Partial<TextPart> = {}): Part {
  return { id: "prt", sessionID: "ses", messageID: "msg", type: "text", text, ...extra }
}

describe("user message text", () => {
  test("keeps typed text literal", () => {
    expect(splitUserMessageText([textPart("# not a heading")])).toEqual({
      text: "# not a heading",
      markdown: "",
    })
  })

  test("routes a part that opted in to the markdown body", () => {
    expect(splitUserMessageText([textPart("# heading", { metadata: { render: "markdown" } })])).toEqual({
      text: "",
      markdown: "# heading",
    })
  })

  test("keeps both bodies when a message mixes typed and injected parts", () => {
    const parts = [
      textPart("look at this"),
      textPart("**done**", { metadata: { render: "markdown" } }),
      textPart("and this"),
    ]
    expect(splitUserMessageText(parts)).toEqual({
      text: "look at this\n\nand this",
      markdown: "**done**",
    })
  })

  test("ignores synthetic and empty parts", () => {
    const parts = [
      textPart("hidden", { synthetic: true }),
      textPart("also hidden", { synthetic: true, metadata: { render: "markdown" } }),
      textPart(""),
      textPart("visible"),
    ]
    expect(splitUserMessageText(parts)).toEqual({ text: "visible", markdown: "" })
  })

  test("treats an unknown render value as literal text", () => {
    expect(splitUserMessageText([textPart("plain", { metadata: { render: "html" } })])).toEqual({
      text: "plain",
      markdown: "",
    })
  })
})
