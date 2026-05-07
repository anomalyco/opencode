import type { MiddlewareHandler } from "hono"
import * as Log from "@opencode-ai/core/util/log"
import { HEADER, diff, load } from "./shared/fence"

const log = Log.create({ service: "fence-middleware" })

export const FenceMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next()

  const prev = load()
  await next()
  const current = diff(prev, load())

  if (Object.keys(current).length > 0) {
    log.info("header", {
      diff: current,
    })
    c.res.headers.set(HEADER, JSON.stringify(current))
  }
}
