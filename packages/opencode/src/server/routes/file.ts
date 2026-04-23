import { Hono } from "hono"
import { hostedFilesystemDisabledResponse } from "../hosted"
import { lazy } from "../../util/lazy"

/**
 * The API does not expose a host project directory. List returns []; other file endpoints 501.
 */
function isListFilesGet(c: { req: { method: string; path: string } }) {
  if (c.req.method !== "GET") return false
  const p = c.req.path
  return p === "/file" || p === "file"
}

export const FileRoutes = lazy(() =>
  new Hono().use("*", (c) => {
    if (isListFilesGet(c)) {
      return c.json([])
    }
    return hostedFilesystemDisabledResponse()
  }),
)
