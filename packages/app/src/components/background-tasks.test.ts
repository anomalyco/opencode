import { describe, expect, test } from "bun:test"
import type { BackgroundTaskJob, Message, Part, Session, ToolPart } from "@cedric/sdk/v2/client"
import { backgroundTaskMergePrompt, backgroundTasksFromStores } from "./background-tasks"

const directory = "/tmp/cedric-background-tasks"

function session(id: string, parentID?: string): Session {
  return {
    id,
    slug: id,
    projectID: "project",
    directory,
    title: parentID ? `Research auth (@researcher subagent)` : "Main chat",
    version: "dev",
    time: { created: 1, updated: 1 },
    ...(parentID ? { parentID, agent: "researcher" } : {}),
  }
}

function taskPart(output: string): ToolPart {
  return {
    id: "part_task",
    sessionID: "parent",
    messageID: "message_assistant",
    type: "tool",
    callID: "call_task",
    tool: "task",
    state: {
      status: "completed",
      input: {
        description: "Research auth",
        subagent_type: "researcher",
      },
      output,
      title: "Research auth",
      metadata: {
        background: true,
        parentSessionId: "parent",
        sessionId: "child",
        jobId: "child",
      },
      time: { start: 10, end: 20 },
    },
  }
}

function backgroundJob(patch: Partial<BackgroundTaskJob> = {}): BackgroundTaskJob {
  return {
    id: "child",
    sessionID: "child",
    parentSessionID: "parent",
    status: "running",
    startedAt: 30,
    updatedAt: 30,
    ...patch,
  }
}

function assistantMessage(id: string): Message {
  return {
    id,
    sessionID: "child",
    role: "assistant",
    parentID: "child_user",
    modelID: "test-model",
    providerID: "test",
    mode: "researcher",
    agent: "researcher",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 50 },
  }
}

describe("backgroundTasksFromStores", () => {
  test("shows a background task as running while the child session is busy", () => {
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [
            taskPart(
              [
                '<task id="child" state="running">',
                "<task_result>",
                "The task is working in the background.",
                "</task_result>",
                "</task>",
              ].join("\n"),
            ),
          ],
        },
        statuses: { child: { type: "busy" } },
        backgroundJobs: [],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("running")
    expect(tasks[0]?.agent).toBe("researcher")
    expect(tasks[0]?.progress).toBe(65)
  })

  test("uses injected task result text when the background task finishes", () => {
    const resultPart: Part = {
      id: "part_result",
      sessionID: "parent",
      messageID: "message_result",
      type: "text",
      text: [
        '<task id="child" state="completed">',
        "<summary>Background task completed: Research auth</summary>",
        "<task_result>",
        "Use a session-backed OAuth flow.",
        "</task_result>",
        "</task>",
      ].join("\n"),
    }
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [taskPart("")],
          message_result: [resultPart],
        },
        statuses: { child: { type: "idle" } },
        backgroundJobs: [],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("completed")
    expect(tasks[0]?.output).toBe("Use a session-backed OAuth flow.")
    expect(backgroundTaskMergePrompt(tasks[0]!)).toContain("Use a session-backed OAuth flow.")
  })

  test("uses backend job output while waiting for parent result injection", () => {
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [taskPart("")],
        },
        statuses: { child: { type: "idle" } },
        backgroundJobs: [backgroundJob({ status: "completed", completedAt: 40, output: "Backend job finished." })],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("completed")
    expect(tasks[0]?.output).toBe("Backend job finished.")
  })

  test("uses backend progress and running detail without final output", () => {
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [taskPart("")],
        },
        statuses: { child: { type: "busy" } },
        backgroundJobs: [backgroundJob({ progress: 45, output: "Drafted the initial findings.", updatedAt: 40 })],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("running")
    expect(tasks[0]?.progress).toBe(45)
    expect(tasks[0]?.detail).toBe("Drafted the initial findings.")
    expect(tasks[0]?.output).toBeUndefined()
  })

  test("uses child assistant text as running detail while provider output streams", () => {
    const livePart: Part = {
      id: "child_text",
      sessionID: "child",
      messageID: "child_assistant",
      type: "text",
      text: "Live streamed findings from the child agent.",
      time: { start: 50 },
    }
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        messages: { child: [assistantMessage("child_assistant")] },
        parts: {
          message_assistant: [taskPart("")],
          child_assistant: [livePart],
        },
        statuses: { child: { type: "busy" } },
        backgroundJobs: [backgroundJob({ progress: 35, output: "Older stage output.", updatedAt: 40 })],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("running")
    expect(tasks[0]?.progress).toBe(35)
    expect(tasks[0]?.detail).toBe("Live streamed findings from the child agent.")
    expect(tasks[0]?.output).toBeUndefined()
  })

  test("shows cancelled backend jobs as stopped tasks", () => {
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [taskPart("")],
        },
        statuses: { child: { type: "idle" } },
        backgroundJobs: [backgroundJob({ status: "cancelled", completedAt: 40 })],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("cancelled")
    expect(tasks[0]?.progress).toBe(100)
    expect(tasks[0]?.output).toBeUndefined()
  })

  test("marks restart-stopped backend jobs as retryable", () => {
    const tasks = backgroundTasksFromStores([
      {
        directory,
        sessions: [session("parent"), session("child", "parent")],
        parts: {
          message_assistant: [taskPart("")],
        },
        statuses: { child: { type: "idle" } },
        backgroundJobs: [
          backgroundJob({
            status: "error",
            completedAt: 40,
            retryable: true,
            error: "Background task stopped before completion because Cedric restarted.",
          }),
        ],
      },
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe("failed")
    expect(tasks[0]?.retryable).toBe(true)
    expect(tasks[0]?.detail).toBe("Background task stopped before completion because Cedric restarted.")
  })
})
