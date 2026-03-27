import type { MiddlewareHandler } from "hono"
import { Flag } from "../flag/flag"
import { getAdaptor } from "./adaptors"
import { WorkspaceID } from "./schema"
import { Workspace } from "./workspace"

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

async function routeRequest(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get("workspace") || req.headers.get("x-opencode-workspace")

  if (!raw) return

  if (local(req.method, url.pathname)) return

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

  const headers = new Headers(req.headers)
  headers.delete("x-opencode-workspace")

  return adaptor.fetch(workspace, `${url.pathname}${url.search}`, {
    method: req.method,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    signal: req.signal,
    headers,
  })
}

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (c, next) => {
  // Only available in development for now
  if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
    return next()
  }

  const response = await routeRequest(c.req.raw)
  if (response) {
    return response
  }
  return next()
}
