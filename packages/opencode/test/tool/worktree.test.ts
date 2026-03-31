import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { SessionID, MessageID } from "../../src/session/schema"
import { EnterWorktreeTool, ExitWorktreeTool } from "../../src/tool/worktree"
import * as WorktreeModule from "../../src/worktree"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.worktree", () => {
  let create: ReturnType<typeof spyOn>
  let remove: ReturnType<typeof spyOn>

  beforeEach(() => {
    create = spyOn(WorktreeModule.Worktree, "create")
    remove = spyOn(WorktreeModule.Worktree, "remove")
  })

  afterEach(async () => {
    create.mockRestore()
    remove.mockRestore()
    await Instance.disposeAll()
  })

  test("enter requests permission and creates worktree", async () => {
    const info = {
      name: "sandbox",
      branch: "opencode/sandbox",
      directory: "/tmp/sandbox",
    }
    create.mockResolvedValue(info)

    const req: Array<{ permission: string; patterns: string[] }> = []
    const tool = await EnterWorktreeTool.init()
    const result = await tool.execute(
      { name: "sandbox", startCommand: "bun install" },
      {
        ...ctx,
        ask: async (input: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
          req.push({ permission: input.permission, patterns: input.patterns })
        },
      },
    )

    expect(req).toEqual([{ permission: "worktree_enter", patterns: ["sandbox"] }])
    expect(create).toHaveBeenCalledWith({ name: "sandbox", startCommand: "bun install" })
    expect(result.metadata).toMatchObject(info)
    expect(result.output).toContain("/tmp/sandbox")
  })

  test("exit requests permission and removes worktree", async () => {
    remove.mockResolvedValue(true)
    const req: Array<{ permission: string; patterns: string[] }> = []
    const tool = await ExitWorktreeTool.init()

    const result = await tool.execute(
      {
        directory: "/tmp/sandbox",
      },
      {
        ...ctx,
        ask: async (input: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
          req.push({ permission: input.permission, patterns: input.patterns })
        },
      },
    )

    expect(req).toEqual([{ permission: "worktree_exit", patterns: ["/tmp/sandbox"] }])
    expect(remove).toHaveBeenCalledWith({ directory: "/tmp/sandbox" })
    expect(result.metadata).toMatchObject({ directory: "/tmp/sandbox", removed: true })
  })

  test("registers enter and exit worktree tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("worktree_enter")
        expect(ids).toContain("worktree_exit")
      },
    })
  })
})
