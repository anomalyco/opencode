import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { createSessionBackground } from "./background"

function tool(
  state: SessionMessageAssistantTool["state"],
  overrides?: Partial<Pick<SessionMessageAssistantTool, "id" | "name">>,
): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "part-1",
    name: "subagent",
    time: { created: 1 },
    state,
    ...overrides,
  }
}

function assistant(id: string, parts: SessionMessageAssistantTool[], completed: boolean) {
  return {
    id,
    type: "assistant" as const,
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: parts,
    time: completed ? { created: 1, completed: 2 } : { created: 1 },
  }
}

function notice(childID: string) {
  return {
    id: `notice-${childID}`,
    type: "synthetic",
    metadata: { source: "subagent", childID },
    text: "",
    time: { created: 3 },
  } as const
}

function background(messages: SessionMessageInfo[]) {
  return createRoot((dispose) => {
    const model = createSessionBackground({
      sessionID: () => "parent",
      messages: () => messages,
      sessions: () => [],
      status: () => "idle",
      shells: () => [],
    })

    const result = { blocking: model.blocking(), tasks: model.tasks() }
    dispose()

    return result
  })
}

describe("subagent background tasks", () => {
  test("backgrounded completions list until their notice lands", () => {
    const part = tool(
      {
        status: "completed",
        input: { description: "Explore", agent: "general" },
        content: [{ type: "text", text: "done" }],
        metadata: { sessionID: "child", status: "running" },
      },
      { id: "a" },
    )

    expect(background([assistant("m1", [part], true)]).tasks).toEqual([
      { id: "child", type: "subagent", label: "Explore", agent: "general" },
    ])
    expect(background([assistant("m1", [part], true), notice("child")]).tasks).toEqual([])
  })

  test("running calls in the latest message block", () => {
    const live = tool({ status: "running", input: { description: "Live" }, metadata: { sessionID: "a" } }, { id: "a" })
    const model = background([assistant("m1", [live], false)])

    expect(model.blocking).toEqual([{ type: "subagent", partID: "a", id: "a", label: "Live" }])
    expect(model.tasks).toEqual([])
  })

  test("stale running calls in older messages stay out of blocking", () => {
    const stale = tool({ status: "running", input: {}, metadata: { sessionID: "old" } }, { id: "s" })
    const model = background([assistant("m1", [stale], true), assistant("m2", [], false)])

    expect(model.blocking).toEqual([])
    expect(model.tasks).toEqual([])
  })

  test("shell calls keep working", () => {
    const shell = tool(
      {
        status: "completed",
        input: { command: "ls" },
        content: [{ type: "text", text: "out" }],
        metadata: { status: "running", shellID: "sh-1" },
      },
      { id: "s", name: "shell" },
    )

    expect(background([assistant("m1", [shell], true)]).tasks).toEqual([{ id: "sh-1", type: "shell", label: "ls" }])
  })
})
