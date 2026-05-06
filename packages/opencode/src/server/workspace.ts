import type { MiddlewareHandler } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { getAdapter } from "@/control-plane/adapters"
import { WorkspaceID } from "@/control-plane/schema"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Workspace } from "@/control-plane/workspace"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppRuntime } from "@/effect/app-runtime"
import { WithInstance } from "@/project/with-instance"
import { Session } from "@/session/session"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ServerProxy } from "./proxy"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute, workspaceProxyURL } from "./shared/workspace-routing"

async function getSessionWorkspace(url: URL) {
  const id = getWorkspaceRouteSessionID(url)
  if (!id) return null

  const session = await AppRuntime.runPromise(
    Session.Service.use((svc) => svc.get(id)).pipe(Effect.withSpan("WorkspaceRouter.lookup")),
  ).catch(() => undefined)
  return session?.workspaceID
}

export function WorkspaceRouterMiddleware(upgrade: UpgradeWebSocket): MiddlewareHandler {
  const log = Log.create({ service: "workspace-router" })

  return async (c, next) => {
    const url = new URL(c.req.url)

    const sessionWorkspaceID = await getSessionWorkspace(url)
    const workspaceID = sessionWorkspaceID || url.searchParams.get("workspace")

    if (!workspaceID || url.pathname.startsWith("/console") || Flag.OPENCODE_WORKSPACE_ID) {
      return next()
    }

    const workspace = await AppRuntime.runPromise(
      Workspace.Service.use((svc) => svc.get(WorkspaceID.make(workspaceID))),
    )

    if (!workspace) {
      return new Response(`Workspace not found: ${workspaceID}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      })
    }

    if (isLocalWorkspaceRoute(c.req.method, url.pathname)) {
      // No instance provided because we are serving cached data; there
      // is no instance to work with
      return next()
    }

    const adapter = getAdapter(workspace.projectID, workspace.type)
    const target = await adapter.target(workspace)

    if (target.type === "local") {
      return WorkspaceContext.provide({
        workspaceID: WorkspaceID.make(workspaceID),
        fn: () =>
          WithInstance.provide({
            directory: target.directory,
            async fn() {
              return next()
            },
          }),
      })
    }

    const proxyURL = workspaceProxyURL(target.url, url)

    log.info("workspace proxy forwarding", {
      workspaceID,
      request: url.toString(),
      target: String(target.url),
      proxy: proxyURL.toString(),
    })

    if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
      return ServerProxy.websocket(upgrade, proxyURL, target.headers, c.req.raw, c.env)
    }

    const headers = new Headers(c.req.raw.headers)
    headers.delete("x-opencode-workspace")

    const req = new Request(c.req.raw, { headers })
    return ServerProxy.http(proxyURL, target.headers, req, workspace.id)
  }
}
