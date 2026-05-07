import path from "node:path"
import { Effect, Schema } from "effect"
import { type WorkspaceAdapter, WorkspaceInfo } from "../types"

const WorktreeConfig = Schema.Struct({
  name: WorkspaceInfo.fields.name,
  branch: Schema.String,
  directory: Schema.String,
  extra: WorkspaceInfo.fields.extra,
})
type WorktreeConfig = Schema.Schema.Type<typeof WorktreeConfig>
const decodeWorktreeConfig = Schema.decodeUnknownSync(WorktreeConfig)

async function loadWorktree() {
  const [{ AppRuntime }, { InstanceState }, { Worktree }] = await Promise.all([
    import("@/effect/app-runtime"),
    import("@/effect/instance-state"),
    import("@/worktree"),
  ])
  return { AppRuntime, InstanceState, Worktree }
}

function rootDirectory(info: WorktreeConfig) {
  const extra = info.extra
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return info.directory
  const root = (extra as Record<string, unknown>).root
  return typeof root === "string" ? root : info.directory
}

function extraWithRoot(extra: unknown, root: string) {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return { root }
  return { ...(extra as Record<string, unknown>), root }
}

export const WorktreeAdapter: WorkspaceAdapter = {
  name: "Worktree",
  description: "Create a git worktree",
  async configure(info) {
    const { AppRuntime, InstanceState, Worktree } = await loadWorktree()
    const next = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const worktree = yield* Worktree.Service.use((svc) => svc.makeWorktreeInfo())
        const relative = path.relative(ctx.worktree, ctx.directory)
        const directory =
          relative && !relative.startsWith("..") && !path.isAbsolute(relative)
            ? path.join(worktree.directory, relative)
            : worktree.directory
        return { ...worktree, directory, root: worktree.directory }
      }),
    )
    return {
      ...info,
      name: next.name,
      branch: next.branch,
      directory: next.directory,
      extra: next.directory === next.root ? info.extra : extraWithRoot(info.extra, next.root),
    }
  },
  async create(info) {
    const { AppRuntime, Worktree } = await loadWorktree()
    const config = decodeWorktreeConfig(info)
    await AppRuntime.runPromise(
      Worktree.Service.use((svc) =>
        svc.createFromInfo({
          name: config.name,
          directory: rootDirectory(config),
          target: config.directory,
          branch: config.branch,
        }),
      ),
    )
  },
  async remove(info) {
    const { AppRuntime, Worktree } = await loadWorktree()
    const config = decodeWorktreeConfig(info)
    await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.remove({ directory: rootDirectory(config) })))
  },
  target(info) {
    const config = decodeWorktreeConfig(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
