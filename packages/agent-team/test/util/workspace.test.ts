import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs"
import {
  createWorkspace,
  removeWorkspace,
  resolveWorkspaceURI,
  isOwnWorkspace,
  isOwnWorktree,
  isOtherAgentWorkspace,
  isTeamWorkspace,
  isProtectedPath,
  calculateDiskUsage,
} from "../../src/util/workspace.js"
import { tmpdir, tmpdirWithGit, cleanup } from "../fixture/workspace.js"

describe("createWorkspace", () => {
  let dir: string

  beforeAll(async () => {
    dir = await tmpdir()
  })
  afterAll(async () => {
    await cleanup(dir)
  })

  test("creates correct dir structure", async () => {
    const ws = await createWorkspace(dir, "agent-coder")
    expect(fs.existsSync(path.join(ws, "scratch"))).toBe(true)
    expect(fs.existsSync(path.join(ws, "manifest.json"))).toBe(true)
  })

  test("writes manifest.json", async () => {
    const ws = await createWorkspace(dir, "agent-reviewer", { custom: "data" })
    const manifest = JSON.parse(await fs.promises.readFile(path.join(ws, "manifest.json"), "utf-8"))
    expect(manifest.custom).toBe("data")
  })
})

describe("URI resolution", () => {
  const root = "/project"

  test("workspace:// resolves correctly", () => {
    expect(resolveWorkspaceURI("workspace://agent-coder/scratch/notes.md", "x", root)).toBe(
      "/project/.opencode/workspaces/workspace-agent-coder/scratch/notes.md",
    )
  })

  test("team:// resolves correctly", () => {
    expect(resolveWorkspaceURI("team://src/index.ts", "x", root)).toBe("/project/src/index.ts")
  })

  test("shared:// resolves correctly", () => {
    expect(resolveWorkspaceURI("shared://temp/file.md", "x", root)).toBe("/project/.opencode/team/shared/temp/file.md")
  })

  test("worktree:// resolves correctly", () => {
    expect(resolveWorkspaceURI("worktree://agent-coder/feat/src/app.ts", "x", root)).toBe(
      "/project/.opencode/workspaces/workspace-agent-coder/.worktrees/feat/src/app.ts",
    )
  })

  test("unknown scheme throws", () => {
    expect(() => resolveWorkspaceURI("http://example.com", "x", root)).toThrow()
  })
})

describe("Permission checks", () => {
  test("isOwnWorkspace", () => {
    expect(isOwnWorkspace("/project/.opencode/workspaces/workspace-agent-coder/scratch", "agent-coder")).toBe(true)
    expect(isOwnWorkspace("/project/.opencode/workspaces/workspace-agent-reviewer/scratch", "agent-coder")).toBe(false)
  })

  test("isOwnWorktree", () => {
    expect(isOwnWorktree("/project/.opencode/workspaces/workspace-agent-coder/.worktrees/feat", "agent-coder")).toBe(
      true,
    )
    expect(isOwnWorktree("/project/.opencode/workspaces/workspace-agent-coder/scratch", "agent-coder")).toBe(false)
  })

  test("isOtherAgentWorkspace", () => {
    expect(isOtherAgentWorkspace("/project/.opencode/workspaces/workspace-agent-reviewer/scratch", "agent-coder")).toBe(
      true,
    )
    expect(isOtherAgentWorkspace("/project/.opencode/workspaces/workspace-agent-coder/scratch", "agent-coder")).toBe(
      false,
    )
  })

  test("isTeamWorkspace", () => {
    expect(isTeamWorkspace("/project/src/index.ts", "/project")).toBe(true)
    expect(isTeamWorkspace("/project/.opencode/workspaces/workspace-agent-coder/file.ts", "/project")).toBe(false)
  })

  test("isProtectedPath", () => {
    expect(isProtectedPath("/project/.opencode/team/state.json", [".opencode/team/"])).toBe(true)
    expect(isProtectedPath("/project/src/index.ts", [".opencode/team/"])).toBe(false)
  })
})

describe("calculateDiskUsage", () => {
  test("returns bytes recursively", async () => {
    const dir = await tmpdir()
    await fs.promises.writeFile(path.join(dir, "a.txt"), "hello")
    await fs.promises.mkdir(path.join(dir, "sub"))
    await fs.promises.writeFile(path.join(dir, "sub", "b.txt"), "world")
    const usage = await calculateDiskUsage(dir)
    expect(usage).toBe(10)
    await cleanup(dir)
  })
})
