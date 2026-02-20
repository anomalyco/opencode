import { describe, expect, test } from "bun:test"
import { SessionSummary } from "../../src/session/summary"
import type { MessageV2 } from "../../src/session/message-v2"

function assistant(input: { id: string; parts: MessageV2.Part[] }): MessageV2.WithParts {
  return {
    info: {
      id: input.id,
      sessionID: "s",
      role: "assistant",
      parentID: "u",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      time: { created: 0 },
      cost: 0,
      tokens: {
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: "model",
      providerID: "provider",
    },
    parts: input.parts,
  }
}

function start(input: { id: string; messageID: string; snapshot: string }): MessageV2.StepStartPart {
  return {
    id: input.id,
    sessionID: "s",
    messageID: input.messageID,
    type: "step-start",
    snapshot: input.snapshot,
  }
}

function finish(input: { id: string; messageID: string; snapshot: string }): MessageV2.StepFinishPart {
  return {
    id: input.id,
    sessionID: "s",
    messageID: input.messageID,
    type: "step-finish",
    reason: "stop",
    snapshot: input.snapshot,
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function tool(input: {
  id: string
  messageID: string
  name: string
  args: Record<string, unknown>
}): MessageV2.ToolPart {
  return {
    id: input.id,
    sessionID: "s",
    messageID: input.messageID,
    type: "tool",
    callID: `call-${input.id}`,
    tool: input.name,
    state: {
      status: "completed",
      input: input.args,
      output: "",
      title: "",
      metadata: {},
      time: { start: 0, end: 1 },
    },
  }
}

function step(input: {
  id: string
  from: string
  to: string
  tools: (messageID: string) => MessageV2.ToolPart[]
}): MessageV2.WithParts {
  const messageID = `m-${input.id}`
  return assistant({
    id: messageID,
    parts: [
      start({ id: `start-${input.id}`, messageID, snapshot: input.from }),
      ...input.tools(messageID),
      finish({ id: `finish-${input.id}`, messageID, snapshot: input.to }),
    ],
  })
}

describe("SessionSummary.isGitSyncBashCommand", () => {
  test("matches git sync command chains", () => {
    expect(SessionSummary.isGitSyncBashCommand("git switch dev && git pull --ff-only")).toBe(true)
    expect(SessionSummary.isGitSyncBashCommand("git -C . status && git fetch origin dev")).toBe(true)
  })

  test("rejects non-sync shell commands", () => {
    expect(SessionSummary.isGitSyncBashCommand("git pull && bun test")).toBe(false)
    expect(SessionSummary.isGitSyncBashCommand("bun test")).toBe(false)
  })
})

describe("SessionSummary.diffWindow", () => {
  test("uses first and last local steps when no sync step exists", () => {
    const one = step({
      id: "1",
      from: "a",
      to: "b",
      tools: (messageID) => [tool({ id: "t1", messageID, name: "bash", args: { command: "bun test" } })],
    })
    const two = step({
      id: "2",
      from: "b",
      to: "c",
      tools: (messageID) => [
        tool({
          id: "t2",
          messageID,
          name: "edit",
          args: { filePath: "README.md", oldString: "a", newString: "b" },
        }),
      ],
    })

    expect(SessionSummary.diffWindow({ messages: [one, two] })).toStrictEqual({ from: "a", to: "c" })
  })

  test("returns undefined for sync-only steps", () => {
    const sync = step({
      id: "sync",
      from: "a",
      to: "b",
      tools: (messageID) => [
        tool({
          id: "sync-tool",
          messageID,
          name: "bash",
          args: { command: "git switch dev && git pull --ff-only" },
        }),
      ],
    })

    expect(SessionSummary.diffWindow({ messages: [sync] })).toBeUndefined()
  })

  test("treats git status followed by git pull as sync-only", () => {
    const sync = step({
      id: "sync",
      from: "a",
      to: "b",
      tools: (messageID) => [
        tool({ id: "status", messageID, name: "bash", args: { command: "git status" } }),
        tool({ id: "pull", messageID, name: "bash", args: { command: "git pull --ff-only" } }),
      ],
    })

    expect(SessionSummary.diffWindow({ messages: [sync] })).toBeUndefined()
  })

  test("resets baseline to the first local step after a sync step", () => {
    const sync = step({
      id: "1",
      from: "a",
      to: "b",
      tools: (messageID) => [
        tool({
          id: "t1",
          messageID,
          name: "bash",
          args: { command: "git switch dev && git pull --ff-only" },
        }),
      ],
    })
    const local = step({
      id: "2",
      from: "b",
      to: "c",
      tools: (messageID) => [
        tool({
          id: "t2",
          messageID,
          name: "edit",
          args: { filePath: "src/app.ts", oldString: "x", newString: "y" },
        }),
      ],
    })

    expect(SessionSummary.diffWindow({ messages: [sync, local] })).toStrictEqual({ from: "b", to: "c" })
  })

  test("keeps local range when sync step is trailing", () => {
    const local = step({
      id: "1",
      from: "a",
      to: "b",
      tools: (messageID) => [
        tool({
          id: "t1",
          messageID,
          name: "edit",
          args: { filePath: "src/app.ts", oldString: "x", newString: "y" },
        }),
      ],
    })
    const sync = step({
      id: "2",
      from: "b",
      to: "c",
      tools: (messageID) => [tool({ id: "t2", messageID, name: "bash", args: { command: "git pull --ff-only" } })],
    })

    expect(SessionSummary.diffWindow({ messages: [local, sync] })).toStrictEqual({ from: "a", to: "b" })
  })

  test("uses the last local range after a sync boundary", () => {
    const localBefore = step({
      id: "1",
      from: "a",
      to: "b",
      tools: (messageID) => [
        tool({
          id: "t1",
          messageID,
          name: "edit",
          args: { filePath: "src/a.ts", oldString: "1", newString: "2" },
        }),
      ],
    })
    const sync = step({
      id: "2",
      from: "b",
      to: "c",
      tools: (messageID) => [
        tool({ id: "t2", messageID, name: "bash", args: { command: "git switch dev && git pull" } }),
      ],
    })
    const localAfter = step({
      id: "3",
      from: "c",
      to: "d",
      tools: (messageID) => [
        tool({
          id: "t3",
          messageID,
          name: "write",
          args: { filePath: "src/b.ts", content: "ok" },
        }),
      ],
    })

    expect(SessionSummary.diffWindow({ messages: [localBefore, sync, localAfter] })).toStrictEqual({
      from: "c",
      to: "d",
    })
  })
})
