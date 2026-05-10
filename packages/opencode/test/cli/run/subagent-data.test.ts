import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { entryBody } from "@/cli/cmd/run/entry.body"
import {
  bootstrapSubagentData,
  clearFinishedSubagents,
  createSubagentData,
  reduceSubagentData,
  snapshotSubagentData,
} from "@/cli/cmd/run/subagent-data"

type SessionMessage = Parameters<typeof bootstrapSubagentData>[0]["messages"][number]

function visible(commits: Array<Parameters<typeof entryBody>[0]>) {
  return commits.flatMap((item) => {
    const body = entryBody(item)
    if (body.type === "none") {
      return []
    }

    if (body.type === "structured") {
      if (body.snapshot.kind === "code" || body.snapshot.kind === "task") {
        return [body.snapshot.title]
      }

      if (body.snapshot.kind === "diff") {
        return body.snapshot.items.map((item) => item.title)
      }

      if (body.snapshot.kind === "todo") {
        return ["# Todos"]
      }

      return ["# Questions"]
    }

    return [body.content]
  })
}

function reduce(data: ReturnType<typeof createSubagentData>, event: unknown) {
  return reduceSubagentData({
    data,
    event: event as Event,
    sessionID: "parent-1",
    thinking: true,
    limits: {},
  })
}

function taskMessage(sessionID: string, status: "running" | "completed" = "completed"): SessionMessage {
  if (status === "running") {
    return {
      parts: [
        {
          id: `part-${sessionID}`,
          sessionID: "parent-1",
          messageID: `msg-${sessionID}`,
          type: "tool",
          callID: `call-${sessionID}`,
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Scan reducer paths",
              subagent_type: "explore",
            },
            title: "Reducer touchpoints",
            metadata: {
              sessionId: sessionID,
              toolcalls: 4,
            },
            time: { start: 1 },
          },
        },
      ],
    }
  }

  return {
    parts: [
      {
        id: `part-${sessionID}`,
        sessionID: "parent-1",
        messageID: `msg-${sessionID}`,
        type: "tool",
        callID: `call-${sessionID}`,
        tool: "task",
        state: {
          status: "completed",
          input: {
            description: "Scan reducer paths",
            subagent_type: "explore",
          },
          output: "",
          title: "Reducer touchpoints",
          metadata: {
            sessionId: sessionID,
            toolcalls: 4,
          },
          time: { start: 1, end: 2 },
        },
      },
    ],
  }
}

function question(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    questions: [
      {
        question: "Mode?",
        header: "Mode",
        options: [{ label: "Fast", description: "Quick pass" }],
        multiple: false,
      },
    ],
  }
}

describe("run subagent data", () => {
  test("bootstraps tabs and child blockers from parent task parts", () => {
    const data = createSubagentData()

    expect(
      bootstrapSubagentData({
        data,
        messages: [taskMessage("child-1")],
        children: [{ id: "child-1" }, { id: "child-2" }],
        permissions: [
          {
            id: "perm-1",
            sessionID: "child-1",
            permission: "read",
            patterns: ["src/**/*.ts"],
            metadata: {},
            always: [],
          },
          {
            id: "perm-2",
            sessionID: "other",
            permission: "read",
            patterns: ["src/**/*.ts"],
            metadata: {},
            always: [],
          },
        ],
        questions: [question("question-1", "child-1"), question("question-2", "other")],
      }),
    ).toBe(true)

    const snapshot = snapshotSubagentData(data)

    expect(snapshot.tabs).toEqual([
      expect.objectContaining({
        sessionID: "child-1",
        label: "Explore",
        description: "Scan reducer paths",
        title: "Reducer touchpoints",
        status: "completed",
        toolCalls: 4,
      }),
    ])
    expect(snapshot.details).toEqual({
      "child-1": {
        sessionID: "child-1",
        commits: [],
      },
    })
    expect(snapshot.permissions.map((item) => item.id)).toEqual(["perm-1"])
    expect(snapshot.questions.map((item) => item.id)).toEqual(["question-1"])
  })

  test("captures child activity and blocker metadata in the footer detail state", () => {
    const data = createSubagentData()

    bootstrapSubagentData({
      data,
      messages: [taskMessage("child-1", "running")],
      children: [{ id: "child-1" }],
      permissions: [],
      questions: [],
    })

    reduce(data, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "txt-user-1",
          messageID: "msg-user-1",
          sessionID: "child-1",
          type: "text",
          text: "Inspect footer tabs",
        },
      },
    })
    reduce(data, {
      type: "message.updated",
      properties: {
        sessionID: "child-1",
        info: {
          id: "msg-user-1",
          role: "user",
        },
      },
    })
    reduce(data, {
      type: "message.updated",
      properties: {
        sessionID: "child-1",
        info: {
          id: "msg-assistant-1",
          role: "assistant",
        },
      },
    })
    reduce(data, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "reason-1",
          messageID: "msg-assistant-1",
          sessionID: "child-1",
          type: "reasoning",
          text: "planning next steps",
          time: { start: 1 },
        },
      },
    })
    reduce(data, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          messageID: "msg-assistant-1",
          sessionID: "child-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "running",
            input: {
              command: "git status --short",
            },
            time: { start: 1 },
          },
        },
      },
    })
    reduce(data, {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "child-1",
        permission: "bash",
        patterns: ["git status --short"],
        metadata: {},
        always: [],
        tool: {
          messageID: "msg-assistant-1",
          callID: "call-1",
        },
      },
    })
    reduce(data, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "txt-1",
          messageID: "msg-assistant-1",
          sessionID: "child-1",
          type: "text",
          text: "hello",
        },
      },
    })
    reduce(data, {
      type: "message.part.delta",
      properties: {
        sessionID: "child-1",
        messageID: "msg-assistant-1",
        partID: "txt-1",
        field: "text",
        delta: " world",
      },
    })

    const snapshot = snapshotSubagentData(data)

    expect(snapshot.tabs).toEqual([expect.objectContaining({ sessionID: "child-1", status: "running" })])
    expect(visible(snapshot.details["child-1"]?.commits ?? [])).toEqual([
      "› Inspect footer tabs",
      "_Thinking:_ planning next steps",
      "# Shell\n$ git status --short",
      "hello world",
    ])
    expect(snapshot.permissions).toEqual([
      expect.objectContaining({
        id: "perm-1",
        metadata: {
          input: {
            command: "git status --short",
          },
        },
      }),
    ])
    expect(snapshot.questions).toEqual([])
  })

  test("clears finished tabs on the next parent prompt", () => {
    const data = createSubagentData()

    bootstrapSubagentData({
      data,
      messages: [taskMessage("child-1", "completed"), taskMessage("child-2", "running")],
      children: [{ id: "child-1" }, { id: "child-2" }],
      permissions: [],
      questions: [],
    })

    expect(clearFinishedSubagents(data)).toBe(true)
    expect(snapshotSubagentData(data).tabs).toEqual([
      expect.objectContaining({ sessionID: "child-2", status: "running" }),
    ])
  })
})
