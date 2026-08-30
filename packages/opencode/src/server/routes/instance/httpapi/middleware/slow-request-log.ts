import fs from "node:fs"
import path from "path"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { Global } from "@opencode-ai/core/global"

// PERF/observability: record requests slower than OPENCODE_SLOW_REQUEST_MS (default 250,
// empty/garbage values fall back to 250) to <data>/log/slow-requests.jsonl. One line per
// slow request; zero cost when fast. The timer measures handler time only — this layer
// sits inside the compression layer on purpose: slow handlers are the signal, slow
// transports are not. Writes are fire-and-forget so the log never amplifies degradation,
// and the file rotates to slow-requests.jsonl.1 past 10 MB instead of growing forever.
const SLOW_MS = Number(process.env.OPENCODE_SLOW_REQUEST_MS?.trim() || 250) || 250
const OUT = path.join(Global.Path.log, "slow-requests.jsonl")
const MAX_BYTES = 10 * 1024 * 1024

function append(line: string) {
  fs.promises
    .stat(OUT)
    .catch(() => undefined)
    .then((stat) => (stat !== undefined && stat.size > MAX_BYTES ? fs.promises.rename(OUT, `${OUT}.1`) : undefined))
    .then(() => fs.promises.appendFile(OUT, line))
    .catch(() => {})
}

export const slowRequestLogLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const started = performance.now()
    const request = yield* HttpServerRequest.HttpServerRequest
    const response = yield* effect
    const ms = performance.now() - started
    if (ms >= SLOW_MS) {
      append(
        JSON.stringify({
          ts: Date.now(),
          ms: Math.round(ms),
          method: request.method,
          path: request.url.split("?")[0].slice(0, 200),
          status: response.status,
        }) + "\n",
      )
    }
    return response
  }),
).layer
