import z from "zod"
import { Worktree } from "@/worktree"
import { type Adaptor, WorkspaceInfo } from "../types"

const Config = WorkspaceInfo.extend({
  name: WorkspaceInfo.shape.name.unwrap(),
  branch: WorkspaceInfo.shape.branch.unwrap(),
  directory: WorkspaceInfo.shape.directory.unwrap(),
})

type Config = z.infer<typeof Config>

export const WorktreeAdaptor: Adaptor = {
  async configure(info) {
    const worktree = await Worktree.makeWorktreeInfo(info.name ?? undefined)
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const config = Config.parse(info)
    await Worktree.createFromInfo({
      name: config.name,
      directory: config.directory,
      branch: config.branch,
    })
  },
  async remove(info) {
    const config = Config.parse(info)
    await Worktree.remove({ directory: config.directory })
  },
  target(info) {
    const config = Config.parse(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
