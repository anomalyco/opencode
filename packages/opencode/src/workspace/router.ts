// Per-Instance Backend selection. Precedence: Flag > Config > "local".
// Errors surface at backend-access time, not layer-build time — a
// misconfigured tenant fails only its own requests.

import { Context, Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { InstanceState } from "@/effect/instance-state"
import { LocalBackend } from "./backends/local"
import { VercelBackend } from "./backends/vercel"
import type { Workspace } from "./types"
import { WorkspaceError } from "./workspace-error"

type BackendKind = "local" | "vercel"

const isBackendKind = (s: unknown): s is BackendKind => s === "local" || s === "vercel"

export namespace WorkspaceRouter {
  export interface Interface {
    readonly backend: Effect.Effect<Workspace.Backend, WorkspaceError>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceRouter") {}

  const pickBackendKind = (cfg: Config.Info): BackendKind => {
    const flag = Flag.OPENCODE_WORKSPACE_BACKEND?.toLowerCase()
    if (isBackendKind(flag)) return flag
    const fromConfig = cfg.workspace?.backend
    if (isBackendKind(fromConfig)) return fromConfig
    return "local"
  }

  const toWorkspaceError =
    (method: string) =>
    (cause: unknown): WorkspaceError =>
      new WorkspaceError({
        method,
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      })

  export const layer: Layer.Layer<Service, never, Config.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service

      const state = yield* InstanceState.make<Workspace.Backend, WorkspaceError>(
        Effect.fn("WorkspaceRouter.state")(function* () {
          const cfg = yield* config.get()
          const kind = pickBackendKind(cfg)

          if (kind === "local") {
            return yield* LocalBackend.make({ worktree: Instance.worktree }).pipe(
              Effect.provide(CrossSpawnSpawner.defaultLayer),
            )
          }

          // vercel
          const vcfg = (cfg.workspace?.backend === "vercel" ? cfg.workspace.vercel : undefined) ?? {}
          const token = vcfg.token ?? process.env["VERCEL_TOKEN"]
          const teamId = vcfg.teamId ?? process.env["VERCEL_TEAM_ID"]
          const projectId = vcfg.projectId ?? process.env["VERCEL_PROJECT_ID"]
          if (!token || !teamId || !projectId) {
            return yield* Effect.fail(
              new WorkspaceError({
                method: "router.vercel.credentials",
                cause: new Error(
                  "vercel workspace backend requires VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID (env or config.workspace.vercel.*)",
                ),
              }),
            )
          }
          return yield* VercelBackend.make({
            token,
            teamId,
            projectId,
            directory: Instance.directory,
            snapshotId: vcfg.snapshotId ?? process.env["VERCEL_SANDBOX_IMAGE_ID"],
            timeoutMs: vcfg.timeoutMs,
            worktree: vcfg.worktree,
          })
        }),
      )

      return Service.of({
        backend: InstanceState.get(state).pipe(
          Effect.mapError((err) =>
            err instanceof (WorkspaceError as any) ? (err as WorkspaceError) : toWorkspaceError("router.backend")(err),
          ),
        ) as Effect.Effect<Workspace.Backend, WorkspaceError>,
      })
    }),
  )

  export const defaultLayer: Layer.Layer<Service, never, never> = layer.pipe(Layer.provide(Config.defaultLayer))
}
