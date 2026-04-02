import { describe, test, expect, afterEach } from "bun:test"
import { WorktreeExitTool } from "../../src/tool/worktree"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-worktree"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("worktree_exit", () => {
  test("throws when already at repository root", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WorktreeExitTool.init()
        // When directory === worktree (i.e. not inside a worktree), should throw
        expect(tool.execute({}, ctx)).rejects.toThrow("Not inside a worktree")
      },
    })
  })
})

describe("worktree_enter", () => {
  test("tool definition has correct id and parameters", async () => {
    const { WorktreeEnterTool } = await import("../../src/tool/worktree")
    expect(WorktreeEnterTool.id).toBe("worktree_enter")
    const def = await WorktreeEnterTool.init()
    expect(def.description).toContain("worktree")
    // Parameters should accept name and startCommand
    const parsed = def.parameters.safeParse({ name: "test-branch" })
    expect(parsed.success).toBe(true)
  })

  test("worktree_exit has correct id", async () => {
    expect(WorktreeExitTool.id).toBe("worktree_exit")
    const def = await WorktreeExitTool.init()
    expect(def.description).toContain("worktree")
    // remove param should be optional
    const parsed = def.parameters.safeParse({})
    expect(parsed.success).toBe(true)
  })
})
