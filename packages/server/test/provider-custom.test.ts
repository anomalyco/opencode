import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { eventually } from "../../core/test/lib/eventually"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

const acme = {
  id: "acme",
  name: "Acme Gateway",
  package: "@opencode/ai/providers/openai-compatible",
  baseURL: "https://llm.acme.example/v1",
  apiKey: "sk-acme",
  headers: { "x-team": "core" },
  models: [{ id: "qwen3-coder", name: "Qwen 3 Coder" }, { id: "llama-4" }],
}

it.live(
  "creates a custom provider in global config and stores its key as a credential",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-provider-custom-")))
      const config = path.join(tmp.path, "opencode.jsonc")
      yield* Effect.promise(() => fs.writeFile(config, `{\n  // keep this comment\n  "shell": "bash"\n}\n`))
      const server = yield* startServer(tmp.path)
      const url = (route: string) => {
        const result = new URL(route, server.base)
        result.searchParams.set("location[directory]", tmp.path)
        return result
      }
      const create = (body: unknown) =>
        Effect.promise(() =>
          fetch(url("/api/experimental/provider/custom"), {
            method: "POST",
            headers: { ...server.headers, "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
      const get = (route: string) =>
        Effect.promise(() => fetch(url(route), { headers: server.headers }).then((response) => response.json()))

      expect((yield* create(acme)).status).toBe(204)

      const text = yield* Effect.promise(() => fs.readFile(config, "utf8"))
      expect(text).toContain("// keep this comment")
      expect(text).toContain('"shell": "bash"')
      expect(text).not.toContain("sk-acme")
      expect(Bun.JSONC.parse(text)).toMatchObject({
        providers: {
          acme: {
            name: "Acme Gateway",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: "https://llm.acme.example/v1" },
            headers: { "x-team": "core" },
            models: { "qwen3-coder": { name: "Qwen 3 Coder" }, "llama-4": {} },
          },
        },
      })
      expect(yield* get("/api/credential")).toMatchObject({
        data: [{ integrationID: "acme", label: "Acme Gateway" }],
      })
      // Providers and models reload from the config change in the background, like a hand edit.
      const models = yield* eventually(get("/api/model"), (body) => JSON.stringify(body).includes('"providerID":"acme"'))
      expect(models).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ providerID: "acme", id: "qwen3-coder", name: "Qwen 3 Coder" }),
        ]),
      })

      const again = yield* create(acme)
      expect(again.status).toBe(409)
      expect(yield* Effect.promise(() => again.json())).toMatchObject({ _tag: "ConflictError", resource: "acme" })
    }),
  15_000,
)

it.live("rejects catalog IDs, arbitrary packages and malformed input", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-provider-custom-invalid-")))
    const server = yield* startServer(tmp.path)
    const url = (route: string) => {
      const result = new URL(route, server.base)
      result.searchParams.set("location[directory]", tmp.path)
      return result
    }
    const create = (body: unknown) =>
      Effect.promise(() =>
        fetch(url("/api/experimental/provider/custom"), {
          method: "POST",
          headers: { ...server.headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((response) => response.status),
      )
    // Catalog integrations come from plugins, which load after the server starts answering.
    yield* eventually(
      Effect.promise(() => fetch(url("/api/integration"), { headers: server.headers }).then((response) => response.text())),
      (body) => body.includes('"id":"openai"'),
    )

    expect(yield* create({ ...acme, id: "openai" })).toBe(409)
    expect(yield* create({ ...acme, package: "file:///tmp/provider.js" })).toBe(400)
    expect(yield* create({ ...acme, id: "Acme Gateway" })).toBe(400)
    expect(yield* create({ ...acme, baseURL: "llm.acme.example" })).toBe(400)
    expect(yield* create({ ...acme, models: [] })).toBe(400)
    expect(yield* Effect.promise(() => fs.readdir(tmp.path))).not.toContain("opencode.jsonc")
  }),
)
