import { Instance } from "@/project/instance"
import type { MiddlewareHandler } from "hono"
import { Installation } from "../installation"
import { getAdaptor } from "./adaptors"
import { Workspace } from "./workspace"

// This middleware forwards all non-GET requests if the workspace is a
// remote. The remote workspace needs to handle session mutations
async function proxySessionRequest(req: Request) {
  if (req.method === "GET") return
  if (!Instance.directory.startsWith("wrk_")) return

  const workspace = await Workspace.get(Instance.directory)
  if (!workspace) {
    return new Response(`Workspace not found: ${Instance.directory}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }
  if (workspace.config.type === "worktree") return

  const url = new URL(req.url)
  const body = req.method === "HEAD" ? undefined : await req.arrayBuffer()
  return getAdaptor(workspace.config).request(
    workspace.config,
    req.method,
    `${url.pathname}${url.search}`,
    body,
    req.signal,
  )
}

export const SessionProxyMiddleware: MiddlewareHandler = async (c, next) => {
  // Only available in development for now
  if (!Installation.isLocal()) {
    return next()
  }

  const response = await proxySessionRequest(c.req.raw)
  if (response) {
    return response
  }
  return next()
}
