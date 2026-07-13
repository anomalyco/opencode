import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode, type SessionMessageUser } from "@opencode-ai/client/promise"
import {
  createSession,
  resolveCurrentSession,
  sessionHistory,
  sessionVariant,
  type RunSession,
  type SessionMessages,
} from "@opencode-ai/cli/mini/session.shared"

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

afterEach(() => {
  mock.restore()
})

function userMessage(id: string, text: string, input: Partial<SessionMessageUser> = {}): SessionMessageUser {
  return {
    id,
    type: "user",
    text,
    time: { created: 1 },
    ...input,
  }
}

describe("run session shared", () => {
  test("builds user prompts from projected text and attachments", () => {
    const msgs: SessionMessages = [
      userMessage("msg-user-1", "look @scan @note.ts", {
        agents: [{ name: "scan", mention: { start: 5, end: 10, text: "@scan" } }],
        files: [
          {
            data: "",
            mime: "text/plain",
            source: { type: "uri", uri: "file:///tmp/note.ts" },
            mention: { start: 11, end: 19, text: "@note.ts" },
          },
        ],
      }),
    ]

    const out = createSession(msgs)
    expect(out.first).toBe(false)
    expect(out.turns).toHaveLength(1)
    expect(out.turns[0]?.prompt.text).toBe("look @scan @note.ts")
    expect(out.turns[0]?.prompt.parts).toEqual([
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
      {
        type: "agent",
        name: "scan",
        source: {
          start: 5,
          end: 10,
          value: "@scan",
        },
      },
    ])
  })

  test("leaves attachment sources undefined when projected mentions are absent", () => {
    const out = createSession([
      userMessage("msg-user-1", "look @scan @note.ts", {
        agents: [{ name: "scan" }],
        files: [{ data: "", mime: "text/plain", source: { type: "uri", uri: "file:///tmp/note.ts" } }],
      }),
    ])

    expect(out.turns[0]?.prompt).toEqual({
      text: "look @scan @note.ts",
      parts: [
        {
          type: "file",
          mime: "text/plain",
          filename: undefined,
          url: "file:///tmp/note.ts",
          source: undefined,
        },
        {
          type: "agent",
          name: "scan",
          source: undefined,
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

  test("restores current prompt history from stored text and file references", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.message, "list").mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: "msg_prompt",
            type: "user",
            text: "Review @note.ts",
            files: [
              {
                data: "",
                mime: "text/plain",
                name: "note.ts",
                source: { type: "uri", uri: "file:///tmp/note.ts" },
                mention: { start: 7, end: 15, text: "@note.ts" },
              },
            ],
            agents: [],
            time: { created: 1 },
          },
        ],
        cursor: {},
      }),
    )
    spyOn(client.session, "get").mockImplementation(() =>
      Promise.resolve({
        id: "ses_1",
        title: "Session",
        projectID: "proj_1",
        location: { directory: "/tmp" },
        time: { created: 1, updated: 1 },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        model: { providerID: "openai", id: "gpt-5", variant: "high" },
      }),
    )

    const out = await resolveCurrentSession(client, "ses_1")

    expect(out.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(out.variant).toBe("high")
    expect(out.turns[0]?.prompt).toEqual({
      text: "Review @note.ts",
      parts: [
        {
          type: "file",
          url: "file:///tmp/note.ts",
          mime: "text/plain",
          filename: "note.ts",
          source: {
            type: "file",
            path: "note.ts",
            text: { start: 7, end: 15, value: "@note.ts" },
          },
        },
      ],
    })
  })
})
