import { describe, expect, test } from "bun:test"
import {
  createSession,
  sessionHistory,
  sessionVariant,
  type RunSession,
  type SessionMessages,
} from "@/cli/cmd/run/session.shared"

type Message = SessionMessages[number]
type Part = Message["parts"][number]
type TextPart = Extract<Part, { type: "text" }>
type AgentPart = Extract<Part, { type: "agent" }>
type FilePart = Extract<Part, { type: "file" }>

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

function userMessage(id: string, parts: Message["parts"], variant = "high"): Message {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "user",
      time: {
        created: 1,
      },
      agent: "build",
      model: {
        ...model,
        variant,
      },
    },
    parts,
  }
}

function assistantMessage(id: string, parts: Message["parts"]): Message {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "assistant",
      time: {
        created: 1,
      },
      parentID: "msg-user-1",
      modelID: "gpt-5",
      providerID: "openai",
      mode: "chat",
      agent: "build",
      path: {
        cwd: "/tmp",
        root: "/tmp",
      },
      cost: 0,
      tokens: {
        input: 1,
        output: 1,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    },
    parts,
  }
}

function textPart(id: string, messageID: string, text: string, input: Partial<TextPart> = {}): TextPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text,
    synthetic: input.synthetic,
  }
}

function agentPart(id: string, messageID: string, name: string, source?: AgentPart["source"]): AgentPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "agent",
    name,
    source,
  }
}

function filePart(id: string, messageID: string, url: string, input: Partial<FilePart> = {}): FilePart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "file",
    mime: input.mime ?? "text/plain",
    filename: input.filename,
    url,
    source: input.source,
  }
}

describe("run session shared", () => {
  test("builds user prompt text from text, file, and agent parts", () => {
    const msgs: SessionMessages = [
      assistantMessage("msg-assistant-1", [textPart("txt-assistant-1", "msg-assistant-1", "ignore me")]),
      userMessage("msg-user-1", [
        textPart("txt-user-1", "msg-user-1", "look @scan"),
        textPart("txt-user-2", "msg-user-1", "hidden", { synthetic: true }),
        agentPart("agent-user-1", "msg-user-1", "scan", {
          start: 5,
          end: 10,
          value: "@scan",
        }),
        filePart("file-user-1", "msg-user-1", "file:///tmp/note.ts"),
      ]),
    ]

    const out = createSession(msgs)
    expect(out.first).toBe(false)
    expect(out.turns).toHaveLength(1)
    expect(out.turns[0]?.prompt.text).toBe("look @scan @note.ts")
    expect(out.turns[0]?.prompt.parts).toEqual([
      {
        type: "agent",
        name: "scan",
        source: {
          start: 5,
          end: 10,
          value: "@scan",
        },
      },
      {
        type: "file",
        mime: "text/plain",
        filename: undefined,
        url: "file:///tmp/note.ts",
        source: {
          type: "file",
          path: "file:///tmp/note.ts",
          text: {
            start: 11,
            end: 19,
            value: "@note.ts",
          },
        },
      },
    ])
  })

  test("reuses existing mentions when file and agent parts have no source", () => {
    const out = createSession([
      userMessage("msg-user-1", [
        textPart("txt-user-1", "msg-user-1", "look @scan @note.ts"),
        agentPart("agent-user-1", "msg-user-1", "scan"),
        filePart("file-user-1", "msg-user-1", "file:///tmp/note.ts"),
      ]),
    ])

    expect(out.turns[0]?.prompt).toEqual({
      text: "look @scan @note.ts",
      parts: [
        {
          type: "agent",
          name: "scan",
          source: {
            start: 5,
            end: 10,
            value: "@scan",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          filename: undefined,
          url: "file:///tmp/note.ts",
          source: {
            type: "file",
            path: "file:///tmp/note.ts",
            text: {
              start: 11,
              end: 19,
              value: "@note.ts",
            },
          },
        },
      ],
    })
  })

  test("dedupes consecutive history entries, drops blanks, and copies prompt parts", () => {
    const parts = [
      {
        type: "agent" as const,
        name: "scan",
        source: {
          start: 0,
          end: 5,
          value: "@scan",
        },
      },
    ]
    const session: RunSession = {
      first: false,
      turns: [
        { prompt: { text: "one", parts }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "one", parts: structuredClone(parts) }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "   ", parts: [] }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "two", parts: [] }, provider: "openai", model: "gpt-5", variant: undefined },
      ],
    }

    const out = sessionHistory(session)

    expect(out.map((item) => item.text)).toEqual(["one", "two"])
    expect(out[0]?.parts).toEqual(parts)
    expect(out[0]?.parts).not.toBe(parts)
    expect(out[0]?.parts[0]).not.toBe(parts[0])
  })

  test("returns the latest matching variant for the active model", () => {
    const session: RunSession = {
      first: false,
      turns: [
        { prompt: { text: "one", parts: [] }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "two", parts: [] }, provider: "anthropic", model: "sonnet", variant: "max" },
        { prompt: { text: "three", parts: [] }, provider: "openai", model: "gpt-5", variant: undefined },
      ],
    }

    expect(sessionVariant(session, model)).toBeUndefined()

    session.turns.push({
      prompt: { text: "four", parts: [] },
      provider: "openai",
      model: "gpt-5",
      variant: "minimal",
    })

    expect(sessionVariant(session, model)).toBe("minimal")
  })
})
