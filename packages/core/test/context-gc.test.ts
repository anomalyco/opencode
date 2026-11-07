import { describe, expect, test } from "bun:test"
import { Message } from "@opencode/ai/effect"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { Skill } from "@opencode/schema/skill"
import { pruneTranscript, toLLMMessages } from "@opencode/core/session/runner/to-llm-message"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })

const text = (message: Message | undefined) =>
  message?.content
    .flatMap((part) => {
      if (part.type === "text") return [part.text]
      if (part.type === "tool-result" && typeof part.result.value === "string") return [part.result.value]
      return []
    })
    .join("\n")

describe("pruneTranscript", () => {
  const reasoning = Message.assistant([
    { type: "reasoning", text: "old thinking" },
    { type: "tool-call", id: "c1", name: "read", input: {} },
  ])
  const bigRead = Message.tool({
    id: "c1",
    name: "read",
    result: { type: "text", value: `Read file a.ts, lines 1-400\n${"x".repeat(4000)}` },
  })

  test("leaves the current turn alone", () => {
    const current = Message.user("now")
    const out = pruneTranscript([reasoning, bigRead, current])
    expect(out[2]).toBe(current)
  })

  test("drops readable reasoning from settled turns but keeps signed blocks", () => {
    const signed = Message.assistant([
      { type: "reasoning", text: "signed", providerMetadata: { anthropic: { signature: "sig" } } },
      { type: "text", text: "answer" },
    ])
    const out = pruneTranscript([reasoning, bigRead, signed, Message.user("now")])
    const settled = out[0]
    expect(settled?.role).toBe("assistant")
    expect(settled?.content.some((part) => part.type === "reasoning")).toBe(false)
    expect(out[2]?.content.some((part) => part.type === "reasoning")).toBe(true)
  })

  test("stubs a large result and keeps the saved-output pointer", () => {
    const truncated = Message.tool({
      id: "c9",
      name: "shell",
      result: {
        type: "text",
        value: `${"y".repeat(3000)}\n[showing lines 1-60 of 9000; full output saved to /tmp/tool_abc]`,
      },
    })
    const out = pruneTranscript([Message.user("old"), truncated, Message.user("now")])
    expect(text(out[1])).toContain("full output saved to /tmp/tool_abc")
  })

  test("marks an older read superseded when a newer read of the same file exists", () => {
    const newer = Message.tool({
      id: "c2",
      name: "read",
      result: { type: "text", value: "Read file a.ts, lines 1-400\nnew content" },
    })
    const out = pruneTranscript([Message.user("old"), bigRead, Message.user("mid"), newer, Message.user("now")])
    expect(text(out[1])).toBe("[superseded by a newer read of a.ts]")
    expect(text(out[3])).toContain("new content")
  })

  test("counts reclaimed chars in stats", () => {
    const stats = { reclaimed: 0 }
    pruneTranscript([Message.user("old"), reasoning, bigRead, Message.user("now")], stats)
    expect(stats.reclaimed).toBeGreaterThan(0)
  })

  test("small results and tiny transcripts pass through", () => {
    const small = Message.tool({ id: "c3", name: "glob", result: { type: "text", value: "a.ts\nb.ts" } })
    const out = pruneTranscript([Message.user("old"), small, Message.user("now")])
    expect(text(out[1])).toBe("a.ts\nb.ts")
    expect(pruneTranscript([Message.user("only")])).toHaveLength(1)
  })
})

describe("toLLMMessages prune", () => {
  test("unloads stale skill bodies but keeps the name", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Skill.make({
          id: id("skill"),
          type: "skill",
          skill: Skill.ID.make("demo"),
          name: Skill.Name.make("demo"),
          text: "long skill body ".repeat(200),
          time: { created },
        }),
        SessionMessage.User.make({ id: id("ask"), type: "user", text: "now", time: { created } }),
      ],
      model,
      model.providerID,
      true,
    )
    expect(text(messages[0])).toBe("[Skill unloaded: demo]")
    expect(text(messages[1])).toBe("now")
  })

  test("without prune nothing changes", () => {
    const messages = toLLMMessages(
      [
        SessionMessage.Skill.make({
          id: id("skill"),
          type: "skill",
          skill: Skill.ID.make("demo"),
          name: Skill.Name.make("demo"),
          text: "body",
          time: { created },
        }),
        SessionMessage.User.make({ id: id("ask"), type: "user", text: "now", time: { created } }),
      ],
      model,
    )
    expect(text(messages[0])).toBe("body")
  })
})
