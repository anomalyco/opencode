import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageSynthetic } from "@opencode-ai/client/promise"
import { selectBackgroundShells } from "./model"

const assistant = {
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  time: { created: 1, completed: 2 },
  content: ["a", "b"].map((id) => ({
    id: `tool_${id}`,
    type: "tool",
    name: "shell",
    time: { created: 1, completed: 2 },
    state: {
      status: "completed",
      input: { command: "echo same command" },
      metadata: { status: "running", shellID: `shell_${id}` },
      content: [{ type: "text", text: "Command moved to the background" }],
    },
  })),
} satisfies SessionMessageAssistant

const notification = (metadata: SessionMessageSynthetic["metadata"]): SessionMessageSynthetic => ({
  id: "msg_notification",
  type: "synthetic",
  text: "Command completed",
  time: { created: 3 },
  metadata,
})

describe("background shell selection", () => {
  test("lists background shells independently even when their commands match", () => {
    expect(selectBackgroundShells([assistant])).toEqual([
      { id: "shell_a", type: "shell", label: "echo same command" },
      { id: "shell_b", type: "shell", label: "echo same command" },
    ])
  })

  test.each(["shell_a", "job_other"])("matches completion by shell ID with job ID %s", (jobID) => {
    expect(
      selectBackgroundShells([
        assistant,
        notification({ source: "shell", jobID, shellID: "shell_a", state: "completed" }),
      ]),
    ).toEqual([{ id: "shell_b", type: "shell", label: "echo same command" }])
  })

  test("retains legacy completion matching by tool-part job ID", () => {
    expect(selectBackgroundShells([assistant, notification({ source: "shell", jobID: "tool_a" })])).toEqual([
      { id: "shell_b", type: "shell", label: "echo same command" },
    ])
  })

  test("retains tool-part IDs for older shells without shell metadata", () => {
    const legacy = {
      ...assistant,
      content: assistant.content.map((part) => ({
        ...part,
        state: { ...part.state, metadata: { status: "running" } },
      })),
    }
    expect(selectBackgroundShells([legacy])).toEqual([
      { id: "tool_a", type: "shell", label: "echo same command" },
      { id: "tool_b", type: "shell", label: "echo same command" },
    ])
    expect(selectBackgroundShells([legacy, notification({ source: "shell", jobID: "tool_a" })])).toEqual([
      { id: "tool_b", type: "shell", label: "echo same command" },
    ])
  })

  test("does not treat another notification source as shell completion", () => {
    expect(
      selectBackgroundShells([
        assistant,
        notification({ source: "subagent", childID: "ses_child", shellID: "shell_a", jobID: "tool_a" }),
      ]),
    ).toHaveLength(2)
  })

  test("ignores foreground shells and other tool types", () => {
    expect(
      selectBackgroundShells([
        {
          ...assistant,
          content: [
            { ...assistant.content[0], name: "subagent" },
            {
              id: "tool_foreground",
              type: "tool",
              name: "shell",
              time: { created: 1, completed: 2 },
              state: {
                status: "completed",
                input: { command: "echo foreground" },
                metadata: { status: "completed", shellID: "shell_foreground" },
                content: [{ type: "text", text: "foreground" }],
              },
            },
          ],
        },
      ]),
    ).toEqual([])
  })
})
