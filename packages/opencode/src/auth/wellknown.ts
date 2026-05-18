import { text } from "node:stream/consumers"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { Auth } from "."
import { Process } from "../util/process"

const log = Log.create({ service: "auth.wellknown" })

export const login = Effect.fn("WellknownAuth.login")(function* (url: string) {
  const auth = yield* Auth.Service
  const wellknown = yield* Effect.tryPromise({
    try: () => fetch(`${url}/.well-known/opencode`).then((response) => response.json()),
    catch: (cause) => new Error(`failed to fetch well-known from ${url}`, { cause }),
  })
  if (!wellknown?.auth?.command || !Array.isArray(wellknown.auth.command)) {
    return yield* Effect.fail(new Error(`no auth command in well-known from ${url}`))
  }
  if (typeof wellknown.auth.env !== "string") {
    return yield* Effect.fail(new Error(`no auth env in well-known from ${url}`))
  }

  log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
  const proc = Process.spawn(wellknown.auth.command, { stdout: "pipe" })
  if (!proc.stdout) return yield* Effect.fail(new Error(`failed to spawn auth command for ${url}`))

  const [exit, token] = yield* Effect.tryPromise(() => Promise.all([proc.exited, text(proc.stdout!)]))
  if (exit !== 0) return yield* Effect.fail(new Error(`auth command failed for ${url} (exit ${exit})`))

  yield* auth.set(url, {
    type: "wellknown",
    key: wellknown.auth.env,
    token: token.trim(),
  })
})

export const refreshAll = Effect.fn("WellknownAuth.refreshAll")(function* () {
  const auth = yield* Auth.Service
  for (const [url, entry] of Object.entries(yield* auth.all())) {
    if (entry.type !== "wellknown") continue
    yield* login(url).pipe(
      Effect.tap(() => Effect.sync(() => log.info("refreshed wellknown auth", { url }))),
      Effect.catch((error) => Effect.sync(() => log.warn("failed to refresh wellknown auth", { url, error }))),
    )
  }
})

export * as WellknownAuth from "./wellknown"
