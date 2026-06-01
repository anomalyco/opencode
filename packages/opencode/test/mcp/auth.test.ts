import { expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { McpAuth } from "../../src/mcp/auth"

function authFile() {
  let raw = ""
  let activeWrites = 0
  let sawOverlap = false

  const layer = Layer.effect(
    AppFileSystem.Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service

      return AppFileSystem.Service.of({
        ...fs,
        readJson: (file) =>
          file.endsWith("mcp-auth.json")
            ? Effect.try({
                try: () => {
                  if (!raw) throw new Error("mcp-auth.json missing")
                  return JSON.parse(raw)
                },
                catch: (cause) => new AppFileSystem.FileSystemError({ method: "readJson", cause }),
              })
            : fs.readJson(file),
        writeJson: (file, value, mode) =>
          file.endsWith("mcp-auth.json")
            ? Effect.promise(async () => {
                activeWrites++
                sawOverlap = sawOverlap || activeWrites > 1
                raw = ""
                await sleep(10)
                const next = JSON.stringify(value, null, 2)
                raw = sawOverlap ? `${next}\n}` : next
                activeWrites--
              })
            : fs.writeJson(file, value, mode),
      })
    }),
  ).pipe(Layer.provide(AppFileSystem.defaultLayer))

  return { layer, raw: () => raw }
}

function authService(layer: Layer.Layer<AppFileSystem.Service>) {
  return McpAuth.Service.use((auth) => Effect.succeed(auth)).pipe(
    Effect.provide(McpAuth.layer.pipe(Layer.provide(EffectFlock.defaultLayer), Layer.provide(layer))),
  )
}

test("serializes concurrent auth file updates across service instances", async () => {
  const file = authFile()

  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* authService(file.layer)
      const second = yield* authService(file.layer)

      yield* Effect.all(
        [
          first.updateTokens("posthog", { accessToken: "access-token" }, "https://mcp.posthog.com/mcp"),
          second.updateClientInfo("posthog", { clientId: "client-id" }, "https://mcp.posthog.com/mcp"),
        ],
        { concurrency: "unbounded" },
      )

      const entry = yield* first.get("posthog")
      expect(entry?.tokens?.accessToken).toBe("access-token")
      expect(entry?.clientInfo?.clientId).toBe("client-id")
      expect(entry?.serverUrl).toBe("https://mcp.posthog.com/mcp")
      expect(() => JSON.parse(file.raw())).not.toThrow()
    }),
  )
})

test("serializes concurrent token and client info updates within a single service instance", async () => {
  const file = authFile()

  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* authService(file.layer)

      // Simulate a token refresh racing with a client info save
      yield* Effect.all(
        [
          auth.updateTokens("server-a", { accessToken: "token-1", refreshToken: "refresh-1" }, "https://a.example.com"),
          auth.updateClientInfo("server-a", { clientId: "client-xyz" }, "https://a.example.com"),
        ],
        { concurrency: "unbounded" },
      )

      const entry = yield* auth.get("server-a")
      // Both writes must survive — no data lost from race condition
      expect(entry?.tokens?.accessToken).toBe("token-1")
      expect(entry?.clientInfo?.clientId).toBe("client-xyz")
      // File must remain valid JSON
      expect(() => JSON.parse(file.raw())).not.toThrow()
    }),
  )
})

test("preserves all entries when multiple servers are updated concurrently", async () => {
  const file = authFile()

  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* authService(file.layer)

      yield* Effect.all(
        [
          auth.updateTokens("server-a", { accessToken: "token-a" }, "https://a.example.com"),
          auth.updateTokens("server-b", { accessToken: "token-b" }, "https://b.example.com"),
          auth.updateTokens("server-c", { accessToken: "token-c" }, "https://c.example.com"),
        ],
        { concurrency: "unbounded" },
      )

      const a = yield* auth.get("server-a")
      const b = yield* auth.get("server-b")
      const c = yield* auth.get("server-c")

      expect(a?.tokens?.accessToken).toBe("token-a")
      expect(b?.tokens?.accessToken).toBe("token-b")
      expect(c?.tokens?.accessToken).toBe("token-c")
      expect(() => JSON.parse(file.raw())).not.toThrow()
    }),
  )
})

test("remove is serialized with concurrent updates", async () => {
  const file = authFile()

  await Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* authService(file.layer)

      // First write some entries
      yield* auth.updateTokens("keep", { accessToken: "keep-token" }, "https://keep.example.com")
      yield* auth.updateTokens("remove-me", { accessToken: "gone" }, "https://remove.example.com")

      // Concurrently update "keep" and remove "remove-me"
      yield* Effect.all(
        [
          auth.updateTokens("keep", { accessToken: "updated-token" }, "https://keep.example.com"),
          auth.remove("remove-me"),
        ],
        { concurrency: "unbounded" },
      )

      const kept = yield* auth.get("keep")
      const removed = yield* auth.get("remove-me")

      expect(kept?.tokens?.accessToken).toBe("updated-token")
      expect(removed).toBeUndefined()
      expect(() => JSON.parse(file.raw())).not.toThrow()
    }),
  )
})
