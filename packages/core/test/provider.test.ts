import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Provider } from "@opencode/core/provider"

describe("Provider", () => {
  test("bundles every native provider entrypoint that exports model()", async () => {
    const providers = path.join(import.meta.dir, "../../ai/src/providers")
    const entrypoints = await Promise.all(
      Array.from(new Bun.Glob("**/*.ts").scanSync(providers)).map(async (file) => {
        // Bun.Glob yields native separators, and package specifiers always use "/".
        const specifier = `@opencode/ai/providers/${file.replace(/\.ts$/, "").replaceAll(path.sep, "/")}`
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

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
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
