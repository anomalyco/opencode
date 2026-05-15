import { Effect, Schema } from "effect"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { WorkspaceContext } from "../workspace-context"
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
    const { AppRuntime, Instance, Worktree } = await loadWorktree()
    const ctx = Instance.current
    const workspaceID = WorkspaceContext.workspaceID
    const next = await AppRuntime.runPromise(
      Worktree.Service.use((svc) => svc.makeWorktreeInfo({ detached: true })).pipe(
        Effect.provideService(InstanceRef, ctx),
        Effect.provideService(WorkspaceRef, workspaceID),
      ),
    )
    return {
      ...info,
      name: next.name,
      directory: next.directory,
    }
  },
  async create(info) {
    const { AppRuntime, Instance, Worktree } = await loadWorktree()
    const ctx = Instance.current
    const workspaceID = WorkspaceContext.workspaceID
    const config = decodeWorktreeConfig(info)
    await AppRuntime.runPromise(
      Worktree.Service.use((svc) =>
        svc.createFromInfo({
          name: config.name,
          directory: config.directory,
          ...(config.branch ? { branch: config.branch } : {}),
        }),
      ).pipe(Effect.provideService(InstanceRef, ctx), Effect.provideService(WorkspaceRef, workspaceID)),
    )
  },
  async list() {
    const { AppRuntime, Instance, Worktree } = await loadWorktree()
    const ctx = Instance.current
    const workspaceID = WorkspaceContext.workspaceID
    return (
      await AppRuntime.runPromise(
        Worktree.Service.use((svc) => svc.list()).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.provideService(WorkspaceRef, workspaceID),
        ),
      )
    ).map((info) => ({
      type: "worktree",
      name: info.name,
      branch: info.branch,
      directory: info.directory,
      projectID: ctx.project.id,
    }))
  },
  async remove(info) {
    const { AppRuntime, Instance, Worktree } = await loadWorktree()
    const ctx = Instance.current
    const workspaceID = WorkspaceContext.workspaceID
    const config = decodeWorktreeConfig(info)
    await AppRuntime.runPromise(
      Worktree.Service.use((svc) => svc.remove({ directory: config.directory })).pipe(
        Effect.provideService(InstanceRef, ctx),
        Effect.provideService(WorkspaceRef, workspaceID),
      ),
    )
  },
  target(info) {
    const config = decodeWorktreeConfig(info)
    return {
      type: "local",
      directory: config.directory,
    }
  },
}
