import { describe, expect, mock, beforeAll, afterAll } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createServer, type Server as HTTPServer } from "http"

const MANIFEST = ProviderV2.ID.make("manifest")
const it = testEffect(Provider.defaultLayer)

const withEnv = <A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.assign(process.env, values)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

describe("manifest provider", () => {
  let server: HTTPServer
  let port: number

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "auto",
                object: "model",
                type: "model",
                display_name: "Manifest Auto",
              },
            ],
            has_more: false,
            first_id: "auto",
            last_id: "auto",
          }),
        )
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (addr && typeof addr === "object") {
          port = addr.port
        }
        resolve()
      })
    })
  })

  afterAll(() => {
    server?.close()
  })

  it.instance(
    "manifest provider loads from config with model discovery",
    () =>
      withEnv(
        {},
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[MANIFEST]).toBeDefined()
          expect(providers[MANIFEST].source).toBe("config")
          expect(providers[MANIFEST].models["auto"]).toBeDefined()
          expect(providers[MANIFEST].models["auto"].name).toBe("Manifest Auto")
          expect(providers[MANIFEST].models["auto"].api.npm).toBe("@ai-sdk/openai-compatible")
        }),
      ),
    {
      config: {
        provider: {
          manifest: {
            npm: "@ai-sdk/openai-compatible",
            name: "Manifest",
            options: {
              get baseURL() {
                return `http://127.0.0.1:${port}/v1`
              },
              apiKey: "mnfst_test_key",
            },
            models: {
              auto: {
                name: "Manifest Auto",
              },
            },
          },
        },
      },
    },
  )

  it.instance(
    "manifest provider not loaded without config",
    () =>
      Effect.gen(function* () {
        const provider = yield* Provider.Service
        const providers = yield* provider.list()
        expect(providers[MANIFEST]).toBeUndefined()
      }),
    { config: {} },
  )
})
