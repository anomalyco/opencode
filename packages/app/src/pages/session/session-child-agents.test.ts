import { describe, expect, test } from "bun:test"
import type { Message, Part, Session, ToolPart } from "@opencode-ai/sdk/v2/client"
import { collectSessionChildAgentEntries } from "./session-child-agents"

const session = (input: { id: string; parentID?: string; title?: string; agent?: string; created: number }) =>
  ({
    id: input.id,
    slug: input.id,
    projectID: "proj",
    directory: "/repo",
    parentID: input.parentID,
    title: input.title ?? input.id,
    agent: input.agent,
    version: "0.0.0",
    time: { created: input.created, updated: input.created },
  }) as Session

const assistant = (input: { id: string; sessionID: string; created: number }) =>
  ({
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    parentID: "msg_user",
    time: { created: input.created, completed: input.created + 1 },
    agent: "build",
    model: { providerID: "test", modelID: "model" },
  }) as unknown as Message

const task = (input: {
  id: string
  sessionID: string
  messageID: string
  childID: string
  description: string
  agent: string
  started: number
}) =>
  ({
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID: input.id,
    tool: "task",
    state: {
      status: "completed",
      input: {
        description: input.description,
        subagent_type: input.agent,
      },
      output: "",
      title: input.description,
      metadata: {
        sessionId: input.childID,
      },
      time: { start: input.started, end: input.started + 1 },
    },
  }) satisfies ToolPart

describe("collectSessionChildAgentEntries", () => {
  test("collects task tool child sessions in chronological order", () => {
    const messages = [
      assistant({ id: "msg_1", sessionID: "ses_parent", created: 10 }),
      assistant({ id: "msg_2", sessionID: "ses_parent", created: 20 }),
    ]
    const parts: Record<string, Part[]> = {
      msg_1: [
        task({
          id: "prt_late",
          sessionID: "ses_parent",
          messageID: "msg_1",
          childID: "ses_late",
          description: "late task",
          agent: "scout",
          started: 200,
        }),
      ],
      msg_2: [
        task({
          id: "prt_early",
          sessionID: "ses_parent",
          messageID: "msg_2",
          childID: "ses_early",
          description: "early task",
          agent: "general",
          started: 100,
        }),
      ],
    }

    const entries = collectSessionChildAgentEntries({
      sessionID: "ses_parent",
      messages,
      parts,
      sessions: [
        session({ id: "ses_late", parentID: "ses_parent", title: "Late child", created: 200 }),
        session({ id: "ses_early", parentID: "ses_parent", title: "Early child", created: 100 }),
      ],
    })

    expect(entries.map((entry) => entry.sessionID)).toEqual(["ses_early", "ses_late"])
    expect(entries.map((entry) => entry.title)).toEqual(["Early child", "Late child"])
  })

  test("adds direct child sessions that are not present in loaded tool parts", () => {
    const entries = collectSessionChildAgentEntries({
      sessionID: "ses_parent",
      messages: [],
      parts: {},
      sessions: [
        session({ id: "ses_child", parentID: "ses_parent", title: "Only child", agent: "general", created: 50 }),
      ],
    })

    expect(entries).toEqual([
      {
        id: "session:ses_child",
        sessionID: "ses_child",
        title: "Only child",
        agent: "general",
        created: 50,
      },
    ])
  })

  test("does not duplicate a direct child session already represented by a task tool", () => {
    const message = assistant({ id: "msg_1", sessionID: "ses_parent", created: 10 })
    const entries = collectSessionChildAgentEntries({
      sessionID: "ses_parent",
      messages: [message],
      parts: {
        msg_1: [
          task({
            id: "prt_1",
            sessionID: "ses_parent",
            messageID: "msg_1",
            childID: "ses_child",
            description: "inspect bug",
            agent: "general",
            started: 25,
          }),
        ],
      },
      sessions: [session({ id: "ses_child", parentID: "ses_parent", title: "Inspect bug", created: 25 })],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe("tool:msg_1:prt_1:ses_child")
  })
})
