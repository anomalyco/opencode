import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Config } from "@opencode/schema/config"
import { Connection } from "@opencode/schema/connection"
import { Credential } from "@opencode/schema/credential"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { AbsolutePath } from "@opencode/schema/schema"

it.live("returns ordered config entries for the requested directory", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-config-endpoint-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    const config = path.join(project, "opencode.json")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        JSON.stringify({
          permissions: [
            { action: "shell", resource: "*", effect: "ask" },
            { action: "shell", resource: "git status", effect: "allow" },
          ],
          mcp: { servers: { docs: { type: "remote", url: "https://example.com/mcp" } } },
        }),
      ),
    )
    const server = yield* startServer(global)
    const url = new URL("/api/config", server.base)
    url.searchParams.set("location[directory]", project)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    const body: unknown = yield* Effect.promise(() => response.json())
    const entries = Schema.decodeUnknownSync(Schema.Array(Config.Entry))(body)

    expect(response.status).toBe(200)
    expect(Array.isArray(entries)).toBe(true)
    const document = entries.find(
      (entry): entry is Config.Document => entry.type === "document" && entry.path === config,
    )
    expect(document?.info.permissions).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git status", effect: "allow" },
    ])
    expect(document?.path).toBe(AbsolutePath.make(config))
    if (!Array.isArray(body)) throw new Error("Expected a config entry array")
    const raw = body.find((entry) => isRecord(entry) && entry["type"] === "document" && entry["path"] === config)
    if (!isRecord(raw) || !isRecord(raw["info"])) throw new Error("Expected a config document")
    expect(raw["info"]).not.toHaveProperty("default_agent")
    expect(raw["info"]).not.toHaveProperty("model")
    const mcp = raw["info"]["mcp"]
    if (!isRecord(mcp) || !isRecord(mcp["servers"]) || !isRecord(mcp["servers"]["docs"]))
      throw new Error("Expected an MCP server config")
    expect(mcp["servers"]["docs"]).not.toHaveProperty("headers")
    expect(mcp["servers"]["docs"]).not.toHaveProperty("oauth")
  }),
)

it.live("updates the global shell without replacing unrelated JSONC", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-config-shells-")))
    const global = path.join(tmp.path, "global")
    const config = path.join(global, "opencode.jsonc")
    yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        `{
  // keep this comment
  "model": "provider/model",
  "shell": "bash"
}
`,
      ),
    )
    const server = yield* startServer(global)
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/config", server.base), {
        method: "PATCH",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ shell: "/bin/zsh" }),
      }),
    )

    expect(response.status).toBe(204)
    const text = yield* Effect.promise(() => fs.readFile(config, "utf8"))
    expect(text).toContain("// keep this comment")
    expect(text).toContain('"model": "provider/model"')
    expect(text).toContain('"shell": "/bin/zsh"')

    const shells = yield* Effect.promise(() =>
      fetch(new URL("/api/config/shell", server.base), { headers: server.headers }),
    )
    expect(shells.status).toBe(200)
    expect(Array.isArray(yield* Effect.promise(() => shells.json()))).toBe(true)
  }),
)

it.live(
  "saves a custom provider that becomes a selectable provider and model",
  () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-config-custom-provider-")))
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      const config = path.join(global, "opencode.jsonc")
      yield* Effect.promise(() =>
        Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
      )
      yield* Effect.promise(() =>
        fs.writeFile(
          config,
          `{
  // keep this comment
  "username": "someone",
  "shell": "bash",
  "providers": { "existing": { "name": "Existing provider" } }
}\n`,
        ),
      )
      const server = yield* startServer(global, { filewatcher: true })
      const request = (route: string, init?: RequestInit) =>
        Effect.promise(() => {
          const url = new URL(route, server.base)
          if (!init?.method) url.searchParams.set("location[directory]", project)
          return fetch(url, {
            ...init,
            headers: { ...server.headers, "content-type": "application/json", ...init?.headers },
          })
        })

      // Warm the Location before saving so this exercises reloading an existing catalog.
      const initial = yield* json(request("/api/provider"), Schema.Struct({ data: Schema.Array(Provider.Info) }))
      expect(initial.data.some((provider) => provider.id === "local")).toBe(false)

      // The credential is stored before the config write, exactly as the app's custom provider form does:
      // the integration only exists once the server reloads the config.
      const credential = yield* request("/api/credential", {
        method: "POST",
        body: JSON.stringify({
          integrationID: "local",
          label: "My Local Server",
          value: { type: "key", key: "sk-local" },
        }),
      })
      expect(credential.status).toBe(200)
      const created = Schema.decodeUnknownSync(Schema.Struct({ data: Credential.Entry }))(
        yield* Effect.promise(() => credential.json()),
      )

      const saved = yield* request("/api/experimental/config", {
        method: "PATCH",
        body: JSON.stringify({
          providers: {
            local: {
              name: "My Local Server",
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: "http://127.0.0.1:8080/v1" },
              headers: { "X-Test": "enabled" },
              models: { "my-model": { name: "My Model" } },
            },
            secondary: { name: "Secondary provider", headers: { "X-Old": "remove-on-replacement" } },
          },
        }),
      })
      expect(saved.status).toBe(204)

      const text = yield* Effect.promise(() => fs.readFile(config, "utf8"))
      expect(text).toContain("// keep this comment")
      expect(text).toContain('"username": "someone"')
      expect(text).not.toContain("sk-local")
      const document = Schema.decodeUnknownSync(Config.Document)({
        type: "document",
        info: JSON.parse(text.replace("// keep this comment", "")),
      })
      expect(document.info.providers?.["local"]).toMatchObject({
        name: "My Local Server",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "http://127.0.0.1:8080/v1" },
        headers: { "X-Test": "enabled" },
        models: { "my-model": { name: "My Model" } },
      })
      expect(document.info.shell).toBe("bash")
      expect(document.info.providers?.["existing"]).toEqual({ name: "Existing provider" })
      expect(document.info.providers?.["secondary"]).toEqual({
        name: "Secondary provider",
        headers: { "X-Old": "remove-on-replacement" },
      })

      // Config reloads on a debounce, so the catalog catches up after the write answers.
      const deadline = Date.now() + 15_000
      const providers = yield* poll(
        () => json(request("/api/provider"), Schema.Struct({ data: Schema.Array(Provider.Info) })),
        (body) => body.data.some((provider) => provider.id === "local"),
        deadline,
      )
      expect(providers.data.find((provider) => provider.id === "local")).toMatchObject({
        id: "local",
        name: "My Local Server",
        activation: "enabled",
      })

      const models = yield* poll(
        () => json(request("/api/model"), Schema.Struct({ data: Schema.Array(Model.Info) })),
        (body) => body.data.some((model) => model.providerID === "local" && model.id === "my-model" && model.enabled),
        deadline,
      )
      expect(models.data.find((model) => model.providerID === "local")).toMatchObject({
        providerID: "local",
        id: "my-model",
        name: "My Model",
        enabled: true,
      })

      const integration = yield* json(
        request("/api/integration/local"),
        Schema.Struct({ data: Schema.Struct({ connections: Schema.Array(Connection.Info) }) }),
      )
      expect(integration.data.connections).toEqual([
        { type: "credential", id: created.data.id, label: "My Local Server", method: "key" },
      ])

      const replaced = yield* request("/api/experimental/config", {
        method: "PATCH",
        body: JSON.stringify({ shell: null, providers: { secondary: { name: "Replaced provider" } } }),
      })
      expect(replaced.status).toBe(204)
      const replacement = yield* Effect.promise(() => fs.readFile(config, "utf8"))
      const info = Schema.decodeUnknownSync(Config.Info)(JSON.parse(replacement.replace("// keep this comment", "")))
      expect(info.shell).toBeUndefined()
      expect(info.providers?.["secondary"]).toEqual({ name: "Replaced provider" })
      expect(info.providers?.["local"]).toEqual(document.info.providers?.["local"])
      expect(info.providers?.["existing"]).toEqual({ name: "Existing provider" })
    }),
  30_000,
)

function json<S extends Schema.ConstraintDecoder<unknown>>(read: Effect.Effect<Response>, schema: S) {
  return read.pipe(
    Effect.flatMap((response) => Effect.promise(() => response.json())),
    Effect.map((body) => Schema.decodeUnknownSync(schema)(body)),
  )
}

// The server applies config writes on a debounce; poll a read until it reflects the write.
function poll<A>(read: () => Effect.Effect<A>, ready: (value: A) => boolean, deadline: number) {
  return Effect.gen(function* () {
    while (true) {
      const value = yield* read()
      if (ready(value)) return value
      if (Date.now() >= deadline) return yield* Effect.die(new Error("Timed out waiting for the config write to load"))
      yield* Effect.sleep("100 millis")
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
