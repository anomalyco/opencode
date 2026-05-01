import { Schema } from "effect"
import { type WorkspaceAdapter, WorkspaceInfo } from "../types"

const WorktreeConfig = Schema.Struct({
  name: WorkspaceInfo.fields.name,
  branch: Schema.String,
  directory: Schema.String,
})
const decodeWorktreeConfig = Schema.decodeUnknownSync(WorktreeConfig)

async function loadWorktree() {
  const [{ AppRuntime }, { Worktree }] = await Promise.all([import("@/effect/app-runtime"), import("@/worktree")])
  return { AppRuntime, Worktree }
}

export const WorktreeAdapter: WorkspaceAdapter = {
  name: "Worktree",
  description: "Create a git worktree",
  async configure(info) {
    const { AppRuntime, Worktree } = await loadWorktree()
    const next = await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.makeWorktreeInfo()))
    return {
      ...info,
      name: next.name,
      branch: next.branch,
      directory: next.directory,
    }
  },
  async create(info) {
    const { AppRuntime, Worktree } = await loadWorktree()
    const config = decodeWorktreeConfig(info)
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
    const { AppRuntime, Worktree } = await loadWorktree()
    const config = decodeWorktreeConfig(info)
    await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.remove({ directory: config.directory })))
  },
  target(info) {
    const config = decodeWorktreeConfig(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
