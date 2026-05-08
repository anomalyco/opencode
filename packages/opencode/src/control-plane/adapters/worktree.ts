import { Schema } from "effect"
import { type WorkspaceAdapter, WorkspaceInfo } from "../types"

const WorktreeConfig = Schema.Struct({
  name: WorkspaceInfo.fields.name,
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  directory: Schema.String,
})
const decodeWorktreeConfig = Schema.decodeUnknownSync(WorktreeConfig)

async function loadWorktree() {
  const [{ AppRuntime }, { Instance }, { Worktree }] = await Promise.all([
    import("@/effect/app-runtime"),
    import("@/project/instance"),
    import("@/worktree"),
  ])
  return { AppRuntime, Instance, Worktree }
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
          branch: config.branch ?? config.name,
        }),
      ),
    )
  },
  async list() {
    const { AppRuntime, Instance, Worktree } = await loadWorktree()
    return (await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.list()))).map((info) => ({
      type: "worktree",
      name: info.name,
      branch: info.branch ?? null,
      directory: info.directory,
      extra: null,
      projectID: Instance.project.id,
    }))
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
