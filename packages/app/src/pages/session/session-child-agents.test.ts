import { describe, expect, test } from "bun:test"
import type { Message, Part, Session, SessionStatus, ToolPart } from "@opencode-ai/sdk/v2/client"
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

const assistant = (input: { id: string; sessionID: string; created: number; completed?: number | false }) => {
  const time =
    input.completed === false
      ? { created: input.created }
      : { created: input.created, completed: input.completed ?? input.created + 1 }

  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    parentID: "msg_user",
    time,
    agent: "build",
    model: { providerID: "test", modelID: "model" },
  } as unknown as Message
}

const task = (input: {
  id: string
  sessionID: string
  messageID: string
  childID: string
  description: string
  agent: string
  started: number
  background?: boolean
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
        ...(input.background ? { background: true } : {}),
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
        usage: "not used",
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
    expect(entries[0]?.status).toBe("completed")
    expect(entries[0]?.usage).toBeUndefined()
  })

  test("uses the task description as the title when the child session is not loaded", () => {
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
            agent: "Coder - Implementation Agent",
            started: 25,
          }),
        ],
      },
      sessions: [],
    })

    expect(entries[0]?.title).toBe("inspect bug")
    expect(entries[0]?.agent).toBe("Coder - Implementation Agent")
    expect(entries[0]?.status).toBe("completed")
  })

  test("does not mark background task children completed without loaded child messages", () => {
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
            description: "background work",
            agent: "general",
            started: 25,
            background: true,
          }),
        ],
      },
      sessions: [session({ id: "ses_child", parentID: "ses_parent", title: "Background work", created: 25 })],
    })

    expect(entries[0]?.status).toBeUndefined()
  })

  test("marks direct child sessions not referenced by task metadata as not used", () => {
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
            childID: "ses_used",
            description: "used task",
            agent: "general",
            started: 25,
          }),
        ],
      },
      sessions: [
        session({ id: "ses_used", parentID: "ses_parent", title: "Used child", created: 25 }),
        session({ id: "ses_unused", parentID: "ses_parent", title: "Unused child", agent: "general", created: 30 }),
      ],
    })

    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => [entry.sessionID, entry.usage])).toEqual([
      ["ses_used", undefined],
      ["ses_unused", "not used"],
    ])
  })

  test("uses child session activity over completed task tool status", () => {
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
            description: "keep working",
            agent: "general",
            started: 25,
          }),
        ],
      },
      sessions: [session({ id: "ses_child", parentID: "ses_parent", title: "Keep working", created: 25 })],
      messagesBySession: {
        ses_child: [assistant({ id: "msg_child", sessionID: "ses_child", created: 30, completed: false })],
      },
    })

    expect(entries[0]?.status).toBe("running")
  })

  test("marks completed only when the child assistant has completed", () => {
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
            description: "done work",
            agent: "general",
            started: 25,
          }),
        ],
      },
      sessions: [session({ id: "ses_child", parentID: "ses_parent", title: "Done work", created: 25 })],
      messagesBySession: {
        ses_child: [assistant({ id: "msg_child", sessionID: "ses_child", created: 30, completed: 40 })],
      },
      statuses: {
        ses_child: { type: "busy" } as SessionStatus,
      },
    })

    expect(entries[0]?.status).toBe("completed")
  })
})
