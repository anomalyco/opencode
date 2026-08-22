import fs from "node:fs"
import path from "path"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { Global } from "@opencode-ai/core/global"

// PERF/observability: record requests slower than OPENCODE_SLOW_REQUEST_MS (default 250)
// to <data>/log/slow-requests.jsonl. One line per slow request; zero cost when fast.
const SLOW_MS = Number(process.env.OPENCODE_SLOW_REQUEST_MS ?? 250)
const OUT = path.join(Global.Path.log, "slow-requests.jsonl")

export const slowRequestLogLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const started = performance.now()
    const request = yield* HttpServerRequest.HttpServerRequest
    const response = yield* effect
    const ms = performance.now() - started
    if (ms >= SLOW_MS) {
      const path = request.url.split("?")[0]
      const line =
        JSON.stringify({
          ts: Date.now(),
          ms: Math.round(ms),
          method: request.method,
          path: path.length > 200 ? path.slice(0, 200) : path,
          status: response.status,
        }) + "\n"
      try {
        fs.appendFileSync(OUT, line)
      } catch {}
    }
    return response
  }),
).layer
