import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { tmpdir } from "./fixture/tmpdir"

const win = process.platform === "win32"

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

const npmLayer = (cache: string) =>
  AppNodeBuilder.build(Npm.node, [[Global.node, Global.layerWith({ cache, state: path.join(cache, "state") })]])

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@opencode/acme")).toBe("@opencode/acme")
    expect(Npm.sanitize("@opencode/acme@1.0.0")).toBe("@opencode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/opencode/acme.git"
    const expected = win ? "acme@git+https_//github.com/opencode/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})

describe("Npm.add", () => {
  test("reifies when package cache directory exists without the package installed", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "fixture-provider"))
    await writePackage(path.join(tmp.path, "fixture-provider"), {
      name: "fixture-provider",
      main: "index.js",
    })
    await Bun.write(path.join(tmp.path, "fixture-provider", "index.js"), "export const fixture = true\n")

    const spec = `fixture-provider@file:${path.join(tmp.path, "fixture-provider")}`
    await fs.mkdir(path.join(tmp.path, "cache", "packages", Npm.sanitize(spec)), { recursive: true })

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.entrypoint).toBeDefined()
  })

  // Seeds a fake installed copy of `name@version` (with an index.js entry) into the
  // package cache slot for `spec` so Npm.add takes its cache-hit branch.
  const seedCachedPackage = async (cache: string, spec: string, name: string, version: string) => {
    const target = path.join(cache, "packages", Npm.sanitize(spec), "node_modules", name)
    await fs.mkdir(target, { recursive: true })
    await writePackage(target, { name, version, main: "index.js" })
    await Bun.write(path.join(target, "index.js"), "export const fixture = true\n")
    return target
  }

  const addWithCache = (cache: string, spec: string) =>
    Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

  test("returns exact-version cache hits without contacting the registry", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "acme@1.0.0"
    await seedCachedPackage(cache, spec, "acme", "1.0.0")

    let registryCalls = 0
    const originalFetch = global.fetch
    global.fetch = (() => {
      registryCalls++
      throw new Error("registry must not be contacted for exact versions")
    }) as typeof fetch

    try {
      const entry = await addWithCache(cache, spec)
      expect(entry.entrypoint).toBeDefined()
      expect(registryCalls).toBe(0)
    } finally {
      global.fetch = originalFetch
    }
  })

  test("keeps dist-tag cache hits when the registry reports the same version", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "acme@latest"
    await seedCachedPackage(cache, spec, "acme", "1.0.0")

    const originalFetch = global.fetch
    global.fetch = (async () =>
      new Response(JSON.stringify({ version: "1.0.0" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch

    try {
      const entry = await addWithCache(cache, "acme@latest")
      expect(entry.entrypoint).toBeDefined()
    } finally {
      global.fetch = originalFetch
    }
  })

  test("keeps dist-tag cache hits when the registry is unreachable", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "acme@latest"
    await seedCachedPackage(cache, spec, "acme", "1.0.0")

    const originalFetch = global.fetch
    global.fetch = (async () => {
      throw new Error("offline")
    }) as typeof fetch

    try {
      const entry = await addWithCache(cache, "acme@latest")
      expect(entry.entrypoint).toBeDefined()
    } finally {
      global.fetch = originalFetch
    }
  })
})

describe("Npm.install", () => {
  test("respects omit from project .npmrc", async () => {
    await using tmp = await tmpdir()

    await writePackage(tmp.path, {
      name: "fixture",
      dependencies: {
        "prod-pkg": "file:./prod-pkg",
      },
      devDependencies: {
        "dev-pkg": "file:./dev-pkg",
      },
    })
    await Bun.write(path.join(tmp.path, ".npmrc"), "omit=dev\n")
    await fs.mkdir(path.join(tmp.path, "prod-pkg"))
    await fs.mkdir(path.join(tmp.path, "dev-pkg"))
    await writePackage(path.join(tmp.path, "prod-pkg"), { name: "prod-pkg" })
    await writePackage(path.join(tmp.path, "dev-pkg"), { name: "dev-pkg" })

    await Npm.install(tmp.path)

    await expect(fs.stat(path.join(tmp.path, "node_modules", "prod-pkg"))).resolves.toBeDefined()
    await expect(fs.stat(path.join(tmp.path, "node_modules", "dev-pkg"))).rejects.toThrow()
  })
})
