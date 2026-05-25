import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("instance reload HttpApi", () => {
  it.live(
    "reloads the routed instance",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ git: true, config: { formatter: false, lsp: false } })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/instance/reload", {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toBe(true)
    }),
  )

  it.live(
    "returns a reload error when bootstrap fails",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ git: true, config: { formatter: false, lsp: false } })
      yield* Effect.promise(() =>
        Promise.resolve(app().request("/path", { headers: { "x-opencode-directory": tmp.path } })),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json", formatter: false, lsp: false, provider: "invalid" }),
        ),
      )
      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/instance/reload", {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )

      expect(response.status).toBe(500)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        name: "InstanceReloadError",
      })
    }),
  )
})
