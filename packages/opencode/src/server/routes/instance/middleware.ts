import type { MiddlewareHandler } from "hono"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { WorkspaceID } from "@/control-plane/schema"
import { traceStep } from "@/server/workflow-trace"

export function InstanceMiddleware(workspaceID?: WorkspaceID): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
    const directory = AppFileSystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    traceStep({
      business: "instance",
      method: "resolve_directory",
      detail: {
        directory,
        ...(workspaceID !== undefined ? { workspace_id: String(workspaceID) } : {}),
      },
    })

    return WorkspaceContext.provide({
      workspaceID,
      async fn() {
        traceStep({ business: "instance", method: "workspace.enter" })
        return Instance.provide({
          directory,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          async fn() {
            traceStep({ business: "instance", method: "route.enter" })
            try {
              return await next()
            } finally {
              traceStep({ business: "instance", method: "route.exit" })
            }
          },
        })
      },
    })
  }
}
