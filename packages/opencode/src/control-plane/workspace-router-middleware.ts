import { Instance } from "@/project/instance"
import type { MiddlewareHandler } from "hono"
import { Installation } from "../installation"
import { getAdaptor } from "./adaptors"
import { Workspace } from "./workspace"
import { WorkspaceContext } from "./workspace-context"

// This middleware forwards all non-GET requests if the workspace is a
// remote. The remote workspace needs to handle session mutations
async function routeRequest(req: Request) {
  // Right now, we need to forward all requests to the workspace
  // because we don't have syncing. In the future all GET requests
  // which don't mutate anything will be handled locally
  //
  // if (req.method === "GET") return

  if (!WorkspaceContext.workspaceID) return

  const workspace = await Workspace.get(WorkspaceContext.workspaceID)
  if (!workspace) {
    return new Response(`Workspace not found: ${WorkspaceContext.workspaceID}`, {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const adaptor = await getAdaptor(workspace.type)

  return adaptor.fetch(workspace, `${new URL(req.url).pathname}${new URL(req.url).search}`, {
    method: req.method,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    signal: req.signal,
    headers: req.headers,
  })
}

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (c, next) => {
  // Only available in development for now
  if (!Installation.isLocal()) {
    return next()
  }

  const response = await routeRequest(c.req.raw)
  if (response) {
    return response
  }
  return next()
}
