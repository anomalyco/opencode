import type { ConnectRouter } from "@connectrpc/connect"
import { createFetchHandler } from "@connectrpc/connect/protocol"

export function createHandler(router: ConnectRouter) {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname
    const handler = router.handlers.find((h) => h.requestPath === path)
    if (!handler) return new Response("Not Found", { status: 404 })
    return createFetchHandler(handler)(req)
  }
}
