import { Schema } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Worktree } from "@/worktree"
import { type WorkspaceAdaptor, WorkspaceInfo } from "../types"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const WorktreeConfig = Schema.Struct({
  name: WorkspaceInfo.fields.name,
  branch: Schema.String,
  directory: Schema.String,
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export const WorktreeAdaptor: WorkspaceAdaptor = {
  name: "Worktree",
  description: "Create a git worktree",
  async configure(info) {
    const worktree = await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.makeWorktreeInfo()))
    return {
      ...info,
      name: worktree.name,
      branch: worktree.branch,
      directory: worktree.directory,
    }
  },
  async create(info) {
    const config = WorktreeConfig.zod.parse(info)
    await AppRuntime.runPromise(
      Worktree.Service.use((svc) =>
        svc.createFromInfo({
          name: config.name,
          directory: config.directory,
          branch: config.branch,
        }),
      ),
    )
  },
  async remove(info) {
    const config = WorktreeConfig.zod.parse(info)
    await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.remove({ directory: config.directory })))
  },
  target(info) {
    const config = WorktreeConfig.zod.parse(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
