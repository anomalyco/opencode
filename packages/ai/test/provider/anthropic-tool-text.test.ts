import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, Message, ToolCallPart } from "../../src/index.js"
import { protocol, route } from "../../src/protocols/anthropic-messages.js"
import { it } from "../lib/effect.js"

const lower = (mime: string, encoded: string, header = mime) =>
  protocol.body.from(
    LLM.request({
      model: route.model({ id: "fixture" }),
      cache: "none",
      messages: [
        Message.assistant([ToolCallPart.make({ id: "call_attachment", name: "execute", input: {} })]),
        Message.tool({
          id: "call_attachment",
          name: "execute",
          resultType: "content",
          result: [{ type: "file", mime, name: "notes.md", uri: `data:${header};base64,${encoded}` }],
        }),
      ],
    }),
  )

it.effect("preserves markdown tool text and its title", () =>
  Effect.gen(function* () {
    const text = "# Notes\nCafé 日本語"
    const body = yield* lower("text/markdown", Buffer.from(text).toString("base64"), "application/octet-stream")
    expect(body.messages.at(-1)?.content).toMatchObject([
      {
        type: "tool_result",
        content: [
          { type: "document", title: "notes.md", source: { type: "text", media_type: "text/plain", data: text } },
        ],
      },
    ])
  }),
)

it.effect("accepts UTF-8 charset in tool MIME and data URL", () =>
  Effect.gen(function* () {
    const text = "# Café 日本語"
    const body = yield* lower(
      "text/markdown; charset=utf-8",
      Buffer.from(text).toString("base64"),
      "text/markdown;charset=UTF-8",
    )
    expect(body.messages.at(-1)?.content).toMatchObject([{ content: [{ source: { data: text } }] }])
  }),
)

it.effect("accepts US-ASCII charset in tool MIME and data URL", () =>
  Effect.gen(function* () {
    const text = "# ASCII notes"
    const body = yield* lower(
      'text/markdown; charset="us-ascii"',
      Buffer.from(text).toString("base64"),
      "text/markdown;charset=US-ASCII",
    )
    expect(body.messages.at(-1)?.content).toMatchObject([{ content: [{ source: { data: text } }] }])
  }),
)

it.effect("rejects invalid UTF-8 and unsupported or inaccurate charsets", () =>
  Effect.gen(function* () {
    for (const [mime, encoded, header] of [
      ["text/markdown", "/w==", "text/markdown"],
      ["text/markdown;charset=utf-16le", "SABpAA==", "text/markdown"],
      ["text/markdown", "SABpAA==", "text/markdown;charset=utf-16le"],
      ["text/markdown;charset=us-ascii", "w6k=", "text/markdown"],
    ]) {
      const result = yield* Effect.result(lower(mime!, encoded!, header!))
      expect(result._tag).toBe("Failure")
    }
  }),
)

it.effect("keeps existing text/plain decoding unchanged", () =>
  Effect.gen(function* () {
    const body = yield* lower("text/plain", Buffer.from("Plain notes").toString("base64"))
    expect(body.messages.at(-1)?.content).toMatchObject([{ content: [{ source: { data: "Plain notes" } }] }])
  }),
)

it.effect("accepts charset-qualified text/plain tool attachments", () =>
  Effect.gen(function* () {
    for (const charset of ["utf-8", "us-ascii"]) {
      const body = yield* lower(`text/plain;charset=${charset}`, Buffer.from("Plain notes").toString("base64"))
      expect(body.messages.at(-1)?.content).toMatchObject([{ content: [{ source: { data: "Plain notes" } }] }])
    }
  }),
)
