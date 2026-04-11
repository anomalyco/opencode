import type { MiddlewareHandler } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"
import { ServerProxy } from "./proxy"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceRoutes } from "./instance"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { WorkspaceContext } from "@/control-plane/workspace-context"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

function local(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

function getSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id = url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1]
  if (!id) return null

  return SessionID.make(id)
}

async function getSessionWorkspace(url: URL) {
  const id = getSessionID(url)
  if (!id) return null

  const session = await Session.get(id).catch(() => undefined)
  return session?.workspaceID
}

export function WorkspaceRouterMiddleware(upgrade: UpgradeWebSocket): MiddlewareHandler {
  const routes = lazy(() => InstanceRoutes(upgrade))

  return async (c) => {
    const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
    const directory = Filesystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    const url = new URL(c.req.url)

    const sessionWorkspaceID = await getSessionWorkspace(url)
    const workspaceID = sessionWorkspaceID || url.searchParams.get("workspace")

    // If no workspace is provided we use the project
    if (!workspaceID) {
      return Instance.provide({
        directory,
        init: InstanceBootstrap,
        async fn() {
          return routes().fetch(c.req.raw, c.env)
        },
      })
    }

    const workspace = await Workspace.get(WorkspaceID.make(workspaceID))

    if (!workspace) {
      // Special-case deleting a session in case user's data in a
      // weird state. Allow them to forcefully delete a synced session
      // even if the remote workspace is not in their data.
      //
      // The lets the `DELETE /session/:id` endpoint through and we've
      // made sure that it will run without an instance
      if (url.pathname.match(/\/session\/[^/]+$/) && c.req.method === "DELETE") {
        return routes().fetch(c.req.raw, c.env)
      }

      return new Response(`Workspace not found: ${workspaceID}`, {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      })
    }

    const adaptor = await getAdaptor(workspace.type)
    const target = await adaptor.target(workspace)

    if (target.type === "local") {
      return WorkspaceContext.provide({
        workspaceID: WorkspaceID.make(workspaceID),
        fn: () =>
          Instance.provide({
            directory: target.directory,
            init: InstanceBootstrap,
            async fn() {
              return routes().fetch(c.req.raw, c.env)
            },
          }),
      })
    }

    if (local(c.req.method, url.pathname)) {
      // No instance provided because we are serving cached data; there
      // is no instance to work with
      return routes().fetch(c.req.raw, c.env)
    }

    if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
      return ServerProxy.websocket(upgrade, target, c.req.raw, c.env)
    }

    const headers = new Headers(c.req.raw.headers)
    headers.delete("x-opencode-workspace")

    return ServerProxy.http(
      target,
      new Request(c.req.raw, {
        headers,
      }),
    )
  }
}
