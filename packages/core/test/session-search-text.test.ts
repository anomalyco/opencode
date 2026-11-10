import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSearchText } from "@opencode/core/session/search-text"
import { Shell } from "@opencode/schema/shell"
import { Skill } from "@opencode/schema/skill"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)

const user = (value: string, text: string) =>
  SessionMessage.User.make({ id: id(value), type: "user", text, time: { created } })

const assistant = (value: string, content: SessionMessage.AssistantContent[]) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    content,
    time: { created },
  })

const text = (value: string) => SessionMessage.AssistantText.make({ type: "text", text: value })

const compaction = {
  running: (summary: string) =>
    SessionMessage.CompactionRunning.make({
      id: id("running"),
      type: "compaction",
      status: "running",
      reason: "auto",
      summary,
      time: { created },
    }),
  failed: () =>
    SessionMessage.CompactionFailed.make({
      id: id("failed"),
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "unknown", message: "leak compaction error" },
      time: { created },
    }),
  completed: (summary: string) =>
    SessionMessage.CompactionCompleted.make({
      id: id("completed"),
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary,
      time: { created },
    }),
}

describe("SessionSearchText.fromMessage", () => {
  test("indexes user text", () => {
    expect(SessionSearchText.fromMessage(user("u1", "Why does login fail?"))).toEqual({
      summary: "",
      user_text: "Why does login fail?",
      assistant_text: "",
    })
  })

  test("joins every assistant text part of one message", () => {
    expect(
      SessionSearchText.fromMessage(
        assistant("a1", [text("Looking at the handler."), text(""), text("Found the bug.")]),
      ),
    ).toEqual({ summary: "", user_text: "", assistant_text: "Looking at the handler.\n\nFound the bug." })
  })

  test("indexes only completed compaction summaries", () => {
    expect(SessionSearchText.fromMessage(compaction.completed("Session fixed login."))).toEqual({
      summary: "Session fixed login.",
      user_text: "",
      assistant_text: "",
    })
    expect(SessionSearchText.fromMessage(compaction.running("leak partial draft"))).toBeUndefined()
    expect(SessionSearchText.fromMessage(compaction.failed())).toBeUndefined()
  })

  test("never includes tool, reasoning or attachment content", () => {
    const userFields = SessionSearchText.fromMessage(
      SessionMessage.User.make({
        id: id("u1"),
        type: "user",
        text: "visible prompt",
        files: [{ data: "", mime: "text/plain", source: { type: "inline" }, name: "leakfile.txt" }],
        skills: [{ id: Skill.ID.make("leakskill"), name: Skill.Name.make("leakskill"), text: "leak skill body" }],
        time: { created },
      }),
    )
    const assistantFields = SessionSearchText.fromMessage(
      assistant("a1", [
        SessionMessage.AssistantReasoning.make({ type: "reasoning", text: "leak reasoning" }),
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "streaming",
          name: "leakstreamingtool",
          state: SessionMessage.ToolStateStreaming.make({ status: "streaming", input: '{"leak":"streaming"}' }),
          time: { created },
        }),
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "completed",
          name: "leakcompletedtool",
          state: SessionMessage.ToolStateCompleted.make({
            status: "completed",
            input: { leak: "input" },
            content: [{ type: "text", text: "leak tool output" }],
          }),
          time: { created },
        }),
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "error",
          name: "leakerrortool",
          state: SessionMessage.ToolStateError.make({
            status: "error",
            input: { leak: "input" },
            error: { type: "unknown", message: "leak tool error" },
          }),
          time: { created },
        }),
        text("visible reply"),
      ]),
    )

    expect(userFields).toEqual({ summary: "", user_text: "visible prompt", assistant_text: "" })
    expect(assistantFields).toEqual({ summary: "", user_text: "", assistant_text: "visible reply" })
    expect(JSON.stringify([userFields, assistantFields])).not.toContain("leak")
  })

  test("returns nothing for synthetic, system, skill, shell and tool-only messages", () => {
    const messages = [
      SessionMessage.Synthetic.make({ id: id("s1"), type: "synthetic", text: "leak synthetic", time: { created } }),
      SessionMessage.System.make({ id: id("s2"), type: "system", text: "leak system", time: { created } }),
      SessionMessage.Skill.make({
        id: id("s3"),
        type: "skill",
        skill: Skill.ID.make("leakskill"),
        name: Skill.Name.make("leakskill"),
        text: "leak skill message",
        time: { created },
      }),
      SessionMessage.Shell.make({
        id: id("s4"),
        type: "shell",
        shellID: Shell.ID.create(),
        command: "echo leak",
        status: "exited",
        time: { created },
      }),
      assistant("a1", [SessionMessage.AssistantReasoning.make({ type: "reasoning", text: "leak reasoning" })]),
      user("u1", "   "),
    ]

    expect(messages.map(SessionSearchText.fromMessage)).toEqual(messages.map(() => undefined))
  })

  test("appends identifier subwords to every field", () => {
    expect(SessionSearchText.fromMessage(user("u1", "Call SessionStore.get"))?.user_text).toBe(
      "Call SessionStore.get\nSession Store",
    )
    expect(
      SessionSearchText.fromMessage(assistant("a1", [text("Use parseJSON"), text("then decodeMessageRow")]))
        ?.assistant_text,
    ).toBe("Use parseJSON\n\nthen decodeMessageRow\nparse JSON decode Message Row")
    expect(SessionSearchText.fromMessage(compaction.completed("Fixed decodeMessageRow"))?.summary).toBe(
      "Fixed decodeMessageRow\ndecode Message Row",
    )
  })

  test("keeps the original phrase adjacent", () => {
    const indexed = SessionSearchText.fromMessage(user("u1", "the decodeMessageRow failed again"))?.user_text
    expect(indexed).toBe("the decodeMessageRow failed again\ndecode Message Row")
    expect(indexed?.startsWith("the decodeMessageRow failed again")).toBe(true)
  })
})

describe("SessionSearchText.expand", () => {
  test.each([
    ["decodeMessageRow", "decodeMessageRow\ndecode Message Row"],
    ["SessionStore", "SessionStore\nSession Store"],
    ["XMLHttpRequest", "XMLHttpRequest\nXML Http Request"],
    ["HTTPServer", "HTTPServer\nHTTP Server"],
    ["parseJSON", "parseJSON\nparse JSON"],
    ["base64Encode", "base64Encode\nbase64 Encode"],
    ["utf8ToString", "utf8ToString\nutf8 To String"],
    ["v2", "v2"],
    ["HTTP", "HTTP"],
    ["2FA", "2FA"],
    ["snake_case_name", "snake_case_name"],
    ["plain words stay", "plain words stay"],
    ["", ""],
  ])("%p", (input, output) => {
    expect(SessionSearchText.expand(input)).toBe(output)
  })

  test("collects subwords from every identifier in order, after the verbatim text", () => {
    expect(SessionSearchText.expand("call parseJSON, then SessionStore.get(fooBar)")).toBe(
      "call parseJSON, then SessionStore.get(fooBar)\nparse JSON Session Store foo Bar",
    )
  })

  test("preserves Unicode text and splits cased non-ASCII identifiers", () => {
    expect(SessionSearchText.expand("Ошибка в функции разборСтроки")).toBe(
      "Ошибка в функции разборСтроки\nразбор Строки",
    )
    expect(SessionSearchText.expand("naïveÉtat")).toBe("naïveÉtat\nnaïve État")
    expect(SessionSearchText.expand("会话搜索 🔍 café")).toBe("会话搜索 🔍 café")
  })
})
