import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

// fork: local.model.setCtxSize must refuse a ctx_size above the model's
// achievable ceiling. The TUI dialog annotates and blocks over-ceiling presets,
// but this endpoint is reachable directly — a `--ctx-size 98304` patched onto a
// 32k-trained model is what wedged a live backend.

const MAX_FIT = 32768

function app() {
  return Server.Default().app
}

/** Minimal llama-skein stand-in: reports a fit ceiling and records ctx patches. */
function fakeBackend(options: { maxFitCtx?: number; fitStatus?: number } = {}) {
  const patched: number[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url)
      if (pathname.startsWith("/api/fit/")) {
        if (options.fitStatus && options.fitStatus !== 200) {
          return new Response("nope", { status: options.fitStatus })
        }
        return Response.json({
          model: pathname.slice("/api/fit/".length),
          backend: "llamacpp",
          fit_level: "perfect",
          configured_ctx: MAX_FIT,
          max_safe_ctx: 26050,
          max_fit_ctx: options.maxFitCtx ?? MAX_FIT,
        })
      }
      if (pathname.startsWith("/api/models/config/") && req.method === "PATCH") {
        return req.json().then((body: { ctx_size?: number }) => {
          patched.push(body.ctx_size ?? 0)
          return new Response(null, { status: 202 })
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return {
    patched,
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    [Symbol.asyncDispose]: async () => {
      await server.stop(true)
    },
  }
}

const backendEffect = (options?: Parameters<typeof fakeBackend>[0]) =>
  Effect.acquireRelease(
    Effect.sync(() => fakeBackend(options)),
    (b) => Effect.promise(() => b[Symbol.asyncDispose]()),
  )

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

function setCtxSize(directory: string, ctx_size: number) {
  return Effect.promise(() =>
    Promise.resolve(
      app().request("/local/model/z4/instella-moe/ctx-size", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-opencode-directory": directory },
        body: JSON.stringify({ ctx_size }),
      }),
    ),
  )
}

const providerConfig = (baseURL: string) => ({
  formatter: false as const,
  lsp: false as const,
  provider: { z4: { npm: "@ai-sdk/openai-compatible", options: { baseURL, apiKey: "skein" } } },
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("local.model.setCtxSize ceiling guard", () => {
  it.live(
    "refuses a ctx_size above max_fit_ctx and never patches the backend",
    Effect.gen(function* () {
      const backend = yield* backendEffect()
      const tmp = yield* tmpdirEffect({ config: providerConfig(backend.baseURL) })

      const response = yield* setCtxSize(tmp.path, 98304)

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toBe(false)
      expect(backend.patched).toEqual([])
    }),
  )

  it.live(
    "allows a ctx_size at the ceiling",
    Effect.gen(function* () {
      const backend = yield* backendEffect()
      const tmp = yield* tmpdirEffect({ config: providerConfig(backend.baseURL) })

      const response = yield* setCtxSize(tmp.path, MAX_FIT)

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toBe(true)
      expect(backend.patched).toEqual([MAX_FIT])
    }),
  )

  it.live(
    "lets the patch through when the ceiling is unknown",
    Effect.gen(function* () {
      // A non-llama-skein backend, or one whose VRAM could not be read, reports
      // no usable max_fit_ctx — block nothing rather than break a valid change.
      const backend = yield* backendEffect({ fitStatus: 404 })
      const tmp = yield* tmpdirEffect({ config: providerConfig(backend.baseURL) })

      const response = yield* setCtxSize(tmp.path, 98304)

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toBe(true)
      expect(backend.patched).toEqual([98304])
    }),
  )
})
