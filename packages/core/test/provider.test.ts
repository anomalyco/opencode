import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Provider } from "@opencode/core/provider"

describe("Provider", () => {
  test("bundles every native provider entrypoint that exports model()", async () => {
    const manifest = await Bun.file(path.join(import.meta.dir, "../../ai/package.json")).json()
    const entrypoints = await Promise.all(
      Object.keys(manifest.exports)
        .filter((key) => key.startsWith("./providers/"))
        .map(async (key) => {
          const specifier = `@opencode/ai${key.slice(1)}`
          const module = await import(specifier)
          return typeof module.model === "function" ? specifier : undefined
        }),
    )
    const packages = entrypoints.filter((specifier) => specifier !== undefined).toSorted()

    expect(packages.filter((specifier) => !Provider.builtinPackages.has(specifier))).toEqual([])
    expect(Array.from(Provider.builtinPackages).toSorted()).toEqual(packages)
    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("loads every @opencode/ai entrypoint the bundled models.dev snapshot names", async () => {
    const manifest = await Bun.file(path.join(import.meta.dir, "../../ai/package.json")).json()
    const snapshot: Record<
      string,
      { models?: Record<string, { api?: Record<string, { sdk?: { opencodeai?: string } }> }> }
    > = await Bun.file(path.join(import.meta.dir, "../src/models-dev/snapshot.txt")).json()
    const specifiers = new Set(
      Object.values(snapshot)
        .flatMap((provider) => Object.values(provider.models ?? {}))
        .flatMap((model) => Object.values(model.api ?? {}))
        .map((api) => api.sdk?.opencodeai)
        .filter((specifier): specifier is string => specifier?.startsWith("@opencode/ai/") === true),
    )
    // Protocol entrypoints export no model(), so Core skips the APIs that name them.
    const protocolOnly = new Set(["@opencode/ai/protocols/openai-decisions"])

    expect(
      [...specifiers].filter((specifier) => !(`.${specifier.slice("@opencode/ai".length)}` in manifest.exports)),
    ).toEqual([])
    expect([...specifiers].filter((specifier) => !Provider.builtinPackages.has(specifier)).toSorted()).toEqual(
      [...protocolOnly].filter((specifier) => specifiers.has(specifier)),
    )
  })

  test("keeps loading the hyphenated provider paths existing configs reference", async () => {
    for (const name of ["google-vertex-messages", "openai-compatible-responses"]) {
      const specifier = `@opencode/ai/providers/${name}`
      expect(Provider.builtinPackages.has(specifier)).toBe(true)
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
        cache: { ttl: "1h" },
        encoding: "gzip",
        transport: "websocket",
      }),
    ).toEqual({
      apiKey: "secret",
      reasoningEffort: "high",
    })
  })

  test("inherits shared and loose settings without provider-only policies", () => {
    expect(
      Provider.modelSettings({
        timeout: 60_000,
        chunkTimeout: 30_000,
        transport: "websocket",
        compaction: { type: "native" },
        reasoningEffort: "high",
      }),
    ).toEqual({
      compaction: { type: "native" },
      reasoningEffort: "high",
    })
  })
})
