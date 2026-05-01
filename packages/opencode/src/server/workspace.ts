import type { MiddlewareHandler } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { getAdapter } from "@/control-plane/adapters"
import { WorkspaceID } from "@/control-plane/schema"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Workspace } from "@/control-plane/workspace"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ServerProxy } from "./proxy"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

export function isLocalWorkspaceRoute(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id = url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1]
  if (!id) return null

  return SessionID.make(id)
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  return proxyURL
}

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
          Instance.provide({
            directory: target.directory,
            init: () => AppRuntime.runPromise(InstanceBootstrap),
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
