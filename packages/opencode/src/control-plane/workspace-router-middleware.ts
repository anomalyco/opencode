import type { MiddlewareHandler } from "hono"
import { Flag } from "../flag/flag"
import { getAdaptor } from "./adaptors"
import { WorkspaceID } from "./schema"
import { Workspace } from "./workspace"
import { InstanceRoutes } from "../server/instance"
import { lazy } from "../util/lazy"

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

const routes = lazy(() => InstanceRoutes())

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (c) => {
  if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
    return routes().fetch(c.req.raw, c.env)
  }

  const url = new URL(c.req.url)
  const raw = url.searchParams.get("workspace")

  if (!raw) {
    return routes().fetch(c.req.raw, c.env)
  }

  if (local(c.req.method, url.pathname)) {
    return routes().fetch(c.req.raw, c.env)
  }

  const workspaceID = WorkspaceID.make(raw)
  const workspace = await Workspace.get(workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${workspaceID}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const adaptor = await getAdaptor(workspace.type)
  const headers = new Headers(c.req.raw.headers)
  headers.delete("x-opencode-workspace")

  return adaptor.fetch(workspace, `${url.pathname}${url.search}`, {
    method: c.req.method,
    body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.arrayBuffer(),
    signal: c.req.raw.signal,
    headers,
  })
}
