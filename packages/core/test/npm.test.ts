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

describe("Npm.isMutableRegistrySpec", () => {
  test("treats latest and bare registry specs as mutable", () => {
    expect(Npm.isMutableRegistrySpec("acme@latest")).toBe(true)
    expect(Npm.isMutableRegistrySpec("acme@^1.0.0")).toBe(true)
    expect(Npm.isMutableRegistrySpec("@opencode/acme@latest")).toBe(true)
  })

  test("treats pinned versions and non-registry specs as immutable", () => {
    expect(Npm.isMutableRegistrySpec("acme@1.2.3")).toBe(false)
    expect(Npm.isMutableRegistrySpec("acme@beta")).toBe(false)
    expect(Npm.isMutableRegistrySpec("acme@git+https://github.com/opencode/acme.git")).toBe(false)
    expect(Npm.isMutableRegistrySpec(`acme@file:${path.join("/tmp", "acme")}`)).toBe(false)
  })
})

describe("Npm.shouldRefreshInstall", () => {
  test("refreshes when registry version is newer", () => {
    expect(Npm.shouldRefreshInstall("1.0.0", "2.0.0")).toBe(true)
    expect(Npm.shouldRefreshInstall("2.0.0", "2.0.0")).toBe(false)
    expect(Npm.shouldRefreshInstall("2.0.0", "1.0.0")).toBe(false)
  })

  test("returns false when either version is missing", () => {
    expect(Npm.shouldRefreshInstall(undefined, "2.0.0")).toBe(false)
    expect(Npm.shouldRefreshInstall("1.0.0", undefined)).toBe(false)
  })
})

describe("Npm.add", () => {
  const add = (spec: string, cache: string, options?: Npm.AddOptions) =>
    Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec, options)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

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

    const entry = await add(spec, path.join(tmp.path, "cache"))

    expect(entry.entrypoint).toBeDefined()
  })

  test("refreshes an existing package cache when requested", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const oldSource = path.join(tmp.path, "fixture-provider-old")
    const source = path.join(tmp.path, "fixture-provider-new")
    const spec = `fixture-provider@file:${source}`
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", "fixture-provider")

    await fs.mkdir(oldSource, { recursive: true })
    await writePackage(oldSource, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(oldSource, "index.js"), "export const fixture = false\n")
    await fs.mkdir(source, { recursive: true })
    await writePackage(source, {
      name: "fixture-provider",
      version: "2.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(source, "index.js"), "export const fixture = true\n")
    await fs.mkdir(dir, { recursive: true })
    await writePackage(dir, {
      dependencies: {
        "fixture-provider": `file:${oldSource}`,
      },
    })
    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")

    await add(spec, cache)
    expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")

    await add(spec, cache, { refresh: true })
    expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("2.0.0")
    expect(JSON.parse(await Bun.file(path.join(dir, "package.json")).text()).dependencies["fixture-provider"]).toContain(
      "fixture-provider-new",
    )
  })

  test("keeps pinned cache when registry has a newer version", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const source = path.join(tmp.path, "fixture-provider")
    const spec = `fixture-provider@file:${source}`
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", "fixture-provider")
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(source, { recursive: true })
    await writePackage(source, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(source, "index.js"), "export const fixture = true\n")
    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    const fetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("registry fetch should not run for pinned file specs")
    }) as unknown as typeof fetch
    try {
      await add(spec, cache)
      expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
      expect(await Bun.file(lockfile).exists()).toBe(true)
    } finally {
      globalThis.fetch = fetch
    }
  })

  test("detects stale latest installs when registry reports a newer version", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const oldSource = path.join(tmp.path, "fixture-provider-old")
    const spec = "fixture-provider@latest"
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", "fixture-provider")
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(oldSource, { recursive: true })
    await writePackage(oldSource, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(oldSource, "index.js"), "export const fixture = false\n")
    await fs.mkdir(dir, { recursive: true })
    await writePackage(dir, {
      dependencies: {
        "fixture-provider": `file:${oldSource}`,
      },
    })
    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, {
      name: "fixture-provider",
      version: "1.0.0",
      main: "index.js",
    })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    const fetch = globalThis.fetch
    globalThis.fetch = (async (input: string | Request | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith("/fixture-provider")) {
        return new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), { status: 200 })
      }
      return fetch(input)
    }) as unknown as typeof fetch
    try {
      await expect(add(spec, cache)).rejects.toThrow()
      expect(await Bun.file(lockfile).exists()).toBe(false)
      expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
    } finally {
      globalThis.fetch = fetch
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
