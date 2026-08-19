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

describe("Npm.normalizeRegistrySpec", () => {
  test("appends @latest to bare registry names", () => {
    expect(Npm.normalizeRegistrySpec("acme")).toBe("acme@latest")
    expect(Npm.normalizeRegistrySpec("@opencode/acme")).toBe("@opencode/acme@latest")
  })

  test("leaves specs with explicit versions unchanged", () => {
    expect(Npm.normalizeRegistrySpec("acme@latest")).toBe("acme@latest")
    expect(Npm.normalizeRegistrySpec("acme@^1.0.0")).toBe("acme@^1.0.0")
    expect(Npm.normalizeRegistrySpec("acme@1.2.3")).toBe("acme@1.2.3")
    expect(Npm.normalizeRegistrySpec("acme@beta")).toBe("acme@beta")
  })

  test("leaves non-registry and invalid specs unchanged", () => {
    expect(Npm.normalizeRegistrySpec(`acme@file:${path.join("/tmp", "acme")}`)).toBe(`acme@file:${path.join("/tmp", "acme")}`)
    expect(Npm.normalizeRegistrySpec("acme@git+https://github.com/opencode/acme.git")).toBe("acme@git+https://github.com/opencode/acme.git")
    expect(Npm.normalizeRegistrySpec("alias@npm:other@latest")).toBe("alias@npm:other@latest")
    expect(Npm.normalizeRegistrySpec("alias@npm:other@1.0.0")).toBe("alias@npm:other@1.0.0")
    expect(Npm.normalizeRegistrySpec("not a valid spec!!!")).toBe("not a valid spec!!!")
  })
})

describe("Npm.isMutableRegistrySpec", () => {
  test("treats registry tags, ranges, and mutable aliases as mutable", () => {
    expect(Npm.isMutableRegistrySpec("acme@latest")).toBe(true)
    expect(Npm.isMutableRegistrySpec("acme@beta")).toBe(true)
    expect(Npm.isMutableRegistrySpec("acme@^1.0.0")).toBe(true)
    expect(Npm.isMutableRegistrySpec("@opencode/acme@latest")).toBe(true)
    expect(Npm.isMutableRegistrySpec("acme@npm:other@latest")).toBe(true)
    expect(Npm.isMutableRegistrySpec("acme")).toBe(true)
  })

  test("treats pinned versions and non-registry specs as immutable", () => {
    expect(Npm.isMutableRegistrySpec("acme@1.2.3")).toBe(false)
    expect(Npm.isMutableRegistrySpec("acme@git+https://github.com/opencode/acme.git")).toBe(false)
    expect(Npm.isMutableRegistrySpec(`acme@file:${path.join("/tmp", "acme")}`)).toBe(false)
    expect(Npm.isMutableRegistrySpec("acme@npm:other@1.0.0")).toBe(false)
    expect(Npm.isMutableRegistrySpec("not a valid spec!!!")).toBe(false)
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

  test("keeps the cache for pinned file specs without touching the lockfile", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const source = path.join(tmp.path, "fixture-provider")
    const spec = `fixture-provider@file:${source}`
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", "fixture-provider")
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(source, { recursive: true })
    await writePackage(source, { name: "fixture-provider", version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(source, "index.js"), "export const fixture = true\n")
    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, { name: "fixture-provider", version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    const entry = await add(spec, cache)
    expect(entry.entrypoint).toBeDefined()
    expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
    expect(await Bun.file(lockfile).exists()).toBe(true)
  })

  test("falls back to the cached install without deleting the lockfile when refresh fails", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-provider@latest"
    const name = "fixture-provider"
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", name)
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, { name, version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await writePackage(dir, { dependencies: { [name]: "1.0.0" } })
    await Bun.write(lockfile, "{}")

    const registry = Bun.serve({
      port: 0,
      fetch: () => new Response("registry unavailable", { status: 503 }),
    })
    await Bun.write(path.join(dir, ".npmrc"), `registry=${registry.url.href}\nfetch-retries=0\n`)
    try {
      const entry = await add(spec, cache, { refresh: true })
      expect(entry.entrypoint).toBeDefined()
      expect(await Bun.file(lockfile).exists()).toBe(true)
      expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
    } finally {
      await registry.stop(true)
    }
  })

  test("forces a cache refresh when the refresh option is set", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const source = path.join(tmp.path, "fixture-provider")
    const spec = `fixture-provider@file:${source}`
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", "fixture-provider")
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(source, { recursive: true })
    await writePackage(source, { name: "fixture-provider", version: "2.0.0", main: "index.js" })
    await Bun.write(path.join(source, "index.js"), "export const v = 2\n")
    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, { name: "fixture-provider", version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    await add(spec, cache)
    expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")

    const entry = await add(spec, cache, { refresh: true })
    expect(entry.entrypoint).toBeDefined()
    expect(await Bun.file(lockfile).exists()).toBe(true)
    expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("2.0.0")
  })

  test("skips reify when the installed version matches the latest dist-tag", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-provider@latest"
    const name = "fixture-provider"
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", name)
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, { name, version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    let packumentRequests = 0
    const registry = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname.endsWith("/dist-tags")) return Response.json({ latest: "1.0.0" })
        packumentRequests++
        return new Response("not found", { status: 404 })
      },
    })
    await Bun.write(path.join(dir, ".npmrc"), `registry=${registry.url.href}\nfetch-retries=0\n`)
    try {
      const entry = await add(spec, cache)
      expect(entry.entrypoint).toBeDefined()
      expect(packumentRequests).toBe(0)
      expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
      expect(await Bun.file(lockfile).exists()).toBe(true)
    } finally {
      await registry.stop(true)
    }
  })

  test("reifies when the installed version differs from the latest dist-tag", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-provider@latest"
    const name = "fixture-provider"
    const dir = path.join(cache, "packages", Npm.sanitize(spec))
    const cached = path.join(dir, "node_modules", name)
    const lockfile = path.join(dir, "package-lock.json")

    await fs.mkdir(cached, { recursive: true })
    await writePackage(cached, { name, version: "1.0.0", main: "index.js" })
    await Bun.write(path.join(cached, "index.js"), "export const cached = true\n")
    await Bun.write(lockfile, "{}")

    let packumentRequests = 0
    const registry = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname.endsWith("/dist-tags")) return Response.json({ latest: "2.0.0" })
        packumentRequests++
        return new Response("registry unavailable", { status: 503 })
      },
    })
    await Bun.write(path.join(dir, ".npmrc"), `registry=${registry.url.href}\nfetch-retries=0\n`)
    try {
      const entry = await add(spec, cache)
      expect(entry.entrypoint).toBeDefined()
      expect(packumentRequests).toBeGreaterThan(0)
      expect(JSON.parse(await Bun.file(path.join(cached, "package.json")).text()).version).toBe("1.0.0")
      expect(await Bun.file(lockfile).exists()).toBe(true)
    } finally {
      await registry.stop(true)
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
