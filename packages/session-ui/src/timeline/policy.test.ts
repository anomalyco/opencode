import { describe, expect, test } from "bun:test"
import type { SessionMessageShell } from "@opencode/client/promise"
import { storyTool } from "../storybook/current-session-scenarios"
import { timelinePresets } from "./detail"
import { timelineDefaultOpen } from "./policy"

const preset = (id: (typeof timelinePresets)[number]["id"]) => timelinePresets.find((item) => item.id === id)!.value

const shell = (status: SessionMessageShell["status"], exit?: number): SessionMessageShell => ({
  id: "msg_shell",
  type: "shell",
  shellID: "shell",
  command: "bun test",
  status,
  exit,
  time: { created: 1 },
})

const thought = { type: "reasoning", text: "Checking", time: { created: 1, completed: 2 } } as const

describe("timelineDefaultOpen", () => {
  test.each([
    ["everything", storyTool("shell", "shell", "completed", {}), true],
    ["compact", storyTool("shell", "shell", "completed", {}), false],
    ["detailed", storyTool("edit", "edit", "completed", {}), true],
    ["compact", storyTool("patch", "patch", "completed", {}), false],
    ["everything", thought, true],
    ["detailed", thought, false],
    ["compact", storyTool("execute", "execute", "completed", {}), true],
    ["everything", storyTool("grep", "grep", "completed", {}), false],
    ["quiet", storyTool("grep", "grep", "error", {}), true],
    ["compact", storyTool("grep", "grep", "error", {}), false],
    ["compact", { type: "text", text: "Done" } as const, false],
  ] as const)("%s opens %o: %s", (id, item, open) => {
    expect(timelineDefaultOpen(preset(id), item)).toBe(open)
  })

  test.each([
    ["everything", shell("exited", 0), true],
    ["compact", shell("exited", 0), false],
    ["quiet", shell("exited", 1), true],
    ["quiet", shell("timeout"), true],
    ["quiet", shell("exited", 0), false],
  ] as const)("%s opens a %o command the user ran: %s", (id, item, open) => {
    expect(timelineDefaultOpen(preset(id), item)).toBe(open)
  })
})
