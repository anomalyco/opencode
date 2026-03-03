import z from "zod"
import { Worktree } from "@/worktree"
import type { Adaptor } from "./types"

export const WorktreeConfig = z.object({
  type: z.literal("worktree"),
  directory: z.string(),
  name: z.string(),
  branch: z.string(),
})
type WorktreeConfig = z.infer<typeof WorktreeConfig>

export const WorktreeArgs = z.object({
  type: z.literal("worktree"),
  name: z.string(),
})
type WorktreeArgs = z.infer<typeof WorktreeArgs>

export const WorktreeAdaptor: Adaptor<WorktreeConfig, WorktreeArgs> = {
  async getConfig({ args }) {
    const info = await Worktree.makeWorktreeInfo(args.name)
    return {
      type: "worktree",
      name: info.name,
      branch: info.branch,
      directory: info.directory,
    }
  },
  async create({ config }) {
    return Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    })
  },
  async remove(config: WorktreeConfig) {
    await Worktree.remove({ directory: config.directory })
  },
  async fetch(config: WorktreeConfig, input: RequestInfo | URL, init?: RequestInit) {
    const { WorkspaceServer } = await import("../workspace-server/server")
    const url = input instanceof Request || input instanceof URL ? input : new URL(input, "http://opencode.internal")
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("x-opencode-directory", config.directory)

    const request = new Request(url, { ...init, headers })
    return WorkspaceServer.App().fetch(request)
  },
}
