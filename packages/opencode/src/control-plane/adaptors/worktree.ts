import z from "zod"
import { Worktree } from "@/worktree"
import { type WorkspaceAdaptor, WorkspaceInfo } from "../types"

const WorktreeConfig = z.object({
  name: WorkspaceInfo.shape.name,
  branch: WorkspaceInfo.shape.branch.unwrap(),
  directory: WorkspaceInfo.shape.directory.unwrap(),
})

export const WorktreeAdaptor: WorkspaceAdaptor = {
  name: "Worktree",
  description: "Create a git worktree",
  async configure(info) {
    const worktree = await Worktree.makeWorktreeInfo(undefined)
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const config = WorktreeConfig.parse(info)
    await Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    })
  },
  async remove(info) {
    const config = WorktreeConfig.parse(info)
    await Worktree.remove({ directory: config.directory })
  },
  target(info) {
    const config = WorktreeConfig.parse(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
