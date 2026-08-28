import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
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

async function createGitFixture(directory: string) {
  const repository = path.join(directory, "repository")
  await fs.mkdir(path.join(repository, "dependency"), { recursive: true })
  await writePackage(repository, {
    name: "fixture-git-plugin",
    exports: "./index.js",
    dependencies: { "fixture-dependency": "file:./dependency" },
  })
  await writePackage(path.join(repository, "dependency"), { name: "fixture-dependency", exports: "./index.js" })
  await Bun.write(path.join(repository, "index.js"), "export default { root: true }\n")
  await Bun.write(path.join(repository, "dependency", "index.js"), "export const dependency = true\n")

  const subdirectory = path.join(repository, "packages", "subdirectory-plugin")
  await fs.mkdir(path.join(subdirectory, "dependency"), { recursive: true })
  await writePackage(subdirectory, {
    name: "fixture-subdirectory-plugin",
    exports: "./index.js",
    dependencies: { "fixture-subdirectory-dependency": "file:./dependency" },
  })
  await writePackage(path.join(subdirectory, "dependency"), {
    name: "fixture-subdirectory-dependency",
    exports: "./index.js",
  })
  await Bun.write(path.join(subdirectory, "index.js"), "export default { subdirectory: true }\n")
  await Bun.write(path.join(subdirectory, "dependency", "index.js"), "export const dependency = true\n")

  await Bun.$`git init -q -b fixture-branch ${repository}`
  await Bun.$`git -C ${repository} add .`
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm fixture`
  const commit = await Bun.$`git -C ${repository} rev-parse HEAD`.text().then((value) => value.trim())
  return { repository, commit }
}

async function createRegistryFixture(directory: string) {
  const tarballs = new Map<string, Uint8Array>()
  for (const version of ["1.0.0", "1.1.0"]) {
    const root = path.join(directory, version)
    await fs.mkdir(path.join(root, "package"), { recursive: true })
    await writePackage(path.join(root, "package"), {
      name: "@fixture/registry-plugin",
      version,
      exports: "./index.js",
    })
    await Bun.write(path.join(root, "package", "index.js"), `export const version = "${version}"\n`)
    await Bun.$`tar -czf ${path.join(root, "package.tgz")} -C ${root} package`
    tarballs.set(version, await Bun.file(path.join(root, "package.tgz")).bytes())
  }
  const state = { latest: "1.0.0", offline: false, requests: 0, tarballRequests: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      state.requests++
      if (state.offline) return new Response("offline", { status: 503 })
      const url = new URL(request.url)
      if (decodeURIComponent(url.pathname) === "/@fixture/registry-plugin")
        return Response.json({
          name: "@fixture/registry-plugin",
          "dist-tags": { latest: state.latest },
          versions: Object.fromEntries(
            [...tarballs.keys()].map((version) => [
              version,
              { name: "@fixture/registry-plugin", version, dist: { tarball: `${url.origin}/${version}.tgz` } },
            ]),
          ),
        })
      state.tarballRequests++
      const tarball = tarballs.get(url.pathname.slice(1).replace(".tgz", ""))
      return tarball ? new Response(tarball) : new Response("missing", { status: 404 })
    },
  })
  return {
    state,
    tarball: `${server.url}1.0.0.tgz`,
    async configure(cache: string, spec: string) {
      const root = path.join(cache, "packages", await Npm.cacheKey(spec))
      await fs.mkdir(root, { recursive: true })
      await Bun.write(
        path.join(root, ".npmrc"),
        `@fixture:registry=${server.url}\ncache=${path.join(directory, "npm-cache")}\nfetch-retries=0\naudit=false\n`,
      )
      return root
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true)
    },
  }
}

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

describe("Npm.isRegistryPackage", () => {
  test("accepts registry packages and rejects unsupported install targets", async () => {
    expect(await Npm.isRegistryPackage("plugin")).toBe(true)
    expect(await Npm.isRegistryPackage("@acme/plugin@beta")).toBe(true)
    expect(await Npm.isRegistryPackage("plugin@^1.2.0")).toBe(true)
    expect(await Npm.isRegistryPackage("./plugin")).toBe(false)
    expect(await Npm.isRegistryPackage("github:acme/plugin")).toBe(false)
    expect(await Npm.isRegistryPackage("alias@npm:plugin@1.0.0")).toBe(false)
  })
})

describe("Npm.isInstallablePackage", () => {
  test("accepts registry and npm-compatible Git specs", async () => {
    expect(await Npm.isInstallablePackage("plugin@^1.2.0")).toBe(true)
    expect(await Npm.isInstallablePackage("github:acme/plugin#main")).toBe(true)
    expect(await Npm.isInstallablePackage("git+ssh://git@github.com/acme/plugin.git#main")).toBe(true)
    expect(await Npm.isInstallablePackage("git@github.com:acme/plugin.git")).toBe(true)
    expect(
      await Npm.isInstallablePackage(
        "git+https://github.com/acme/plugins.git#0123456789abcdef0123456789abcdef01234567::path:packages/plugin",
      ),
    ).toBe(true)
    expect(await Npm.isInstallablePackage("./plugin")).toBe(false)
    expect(await Npm.isInstallablePackage("https://example.com/plugin.tgz")).toBe(false)
    expect(await Npm.isInstallablePackage("alias@npm:plugin@1.0.0")).toBe(false)
  })
})

describe("Npm.cacheKey", () => {
  test("preserves registry keys and hashes Git specs", async () => {
    expect(await Npm.cacheKey("@opencode/acme@1.0.0")).toBe(Npm.sanitize("@opencode/acme@1.0.0"))
    const spec = "git+ssh://git@github.com/acme/plugin.git#main"
    expect(await Npm.cacheKey(spec)).toMatch(/^git-[a-f0-9]{64}$/)
    expect(await Npm.cacheKey(spec)).toBe(await Npm.cacheKey(spec))
    expect(await Npm.cacheKey(`${spec}-other`)).not.toBe(await Npm.cacheKey(spec))
  })
})

describe("Npm.add", () => {
  test("resolves cached scoped package specs without reifying", async () => {
    await using tmp = await tmpdir()
    const spec = "@fixture/provider@1.0.0"
    const directory = path.join(
      tmp.path,
      "cache",
      "packages",
      Npm.sanitize(spec),
      "node_modules",
      "@fixture",
      "provider",
    )
    await fs.mkdir(directory, { recursive: true })
    await writePackage(directory, { name: "@fixture/provider", exports: "./index.js" })
    await Bun.write(path.join(directory, "index.js"), "export const fixture = true\n")

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.directory).toBe(directory)
    expect(entry.entrypoint).toEndWith("/index.js")
    expect(entry.revision).toBe("1.0.0")
  })

  test("falls back to the original spec when parsing fails", async () => {
    await using tmp = await tmpdir()
    const spec = "fixture provider"
    const directory = path.join(tmp.path, "cache", "packages", Npm.sanitize(spec), "node_modules", spec)
    await fs.mkdir(directory, { recursive: true })
    await writePackage(directory, { name: spec, exports: "./index.js" })
    await Bun.write(path.join(directory, "index.js"), "export const fixture = true\n")

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.directory).toBe(directory)
    expect(entry.entrypoint).toEndWith("/index.js")
  })

  test("reifies when package cache directory exists without the package installed", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "fixture-provider"))
    await writePackage(path.join(tmp.path, "fixture-provider"), {
      name: "fixture-provider",
      exports: {
        ".": "./index.js",
        "./tui": "./tui.js",
      },
    })
    await Bun.write(path.join(tmp.path, "fixture-provider", "index.js"), "export const fixture = true\n")
    await Bun.write(path.join(tmp.path, "fixture-provider", "tui.js"), "export const tui = true\n")

    const spec = `fixture-provider@file:${path.join(tmp.path, "fixture-provider")}`
    await fs.mkdir(path.join(tmp.path, "cache", "packages", Npm.sanitize(spec)), { recursive: true })

    const entries = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return {
        tui: yield* npm.add(spec, { subpaths: ["tui", ""] }),
        fallback: yield* npm.add(spec, { subpaths: ["missing", ""] }),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entries.tui.entrypoint).toEndWith("/tui.js")
    expect(entries.fallback.entrypoint).toEndWith("/index.js")
  })

  test("installs and resolves named and unnamed Git packages with dependencies", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const specs = [
      `git+file://${fixture.repository}#${fixture.commit}`,
      `fixture-named-plugin@git+file://${fixture.repository}#fixture-branch`,
    ]

    for (const spec of specs) {
      const entries = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        return {
          added: yield* npm.add(spec),
          cached: yield* npm.add(spec),
          resolved: yield* npm.resolve(spec),
        }
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

      expect(entries.added.entrypoint).toEndWith("/index.js")
      expect(entries.added.revision).toBe(fixture.commit)
      expect(entries.cached).toEqual(entries.added)
      expect(entries.resolved).toEqual(entries.added)
      expect(
        await fs.stat(path.join(path.dirname(entries.added.directory), "fixture-dependency", "package.json")),
      ).toBeTruthy()
      expect(entries.added.directory).toContain(path.join("packages", await Npm.cacheKey(spec), "node_modules"))
    }
  })

  test("installs a Git package from an npm ::path: subdirectory", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const spec = `git+file://${fixture.repository}#${fixture.commit}::path:packages/subdirectory-plugin`
    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.directory).toEndWith(path.join("node_modules", "fixture-subdirectory-plugin"))
    expect(entry.entrypoint).toEndWith("/index.js")
    expect(entry.revision).toBe(fixture.commit)
    expect(
      await fs.stat(path.join(path.dirname(entry.directory), "fixture-subdirectory-dependency", "package.json")),
    ).toBeTruthy()
  })

  // Several real Git installs and refreshes exceed Bun's default timeout on Windows.
  test("refreshes mutable Git packages once per service lifetime and preserves pinned or cached installs", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const repository = pathToFileURL(fixture.repository).href
    const mutable = `git+${repository}#fixture-branch`
    const pinned = `git+${repository}#${fixture.commit}`

    const first = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      const mutableEntry = yield* npm.add(mutable, { refresh: true })
      const pinnedEntry = yield* npm.add(pinned, { refresh: true })
      const nextCommit = yield* Effect.promise(async () => {
        await Bun.write(path.join(fixture.repository, "index.js"), 'export default { root: "second" }\n')
        await Bun.$`git -C ${fixture.repository} add .`
        await Bun.$`git -C ${fixture.repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm second`
        return Bun.$`git -C ${fixture.repository} rev-parse HEAD`.text().then((value) => value.trim())
      })
      const lock = path.join(cache, "packages", yield* Effect.promise(() => Npm.cacheKey(mutable)), "package-lock.json")
      const before = yield* Effect.promise(() => Bun.file(lock).bytes())
      expect((yield* npm.resolve(mutable)).revision).toBe(fixture.commit)
      expect(yield* npm.check(mutable)).toEqual({ installed: fixture.commit, available: nextCommit, mutable: true })
      expect(yield* npm.check(pinned)).toEqual({ installed: fixture.commit, available: fixture.commit, mutable: false })
      expect(yield* Effect.promise(() => Bun.file(lock).bytes())).toEqual(before)
      expect(yield* npm.add(mutable)).toEqual(mutableEntry)
      expect(mutableEntry.revision).toBe(fixture.commit)

      const uncached = `git+${repository}#HEAD`
      expect(yield* npm.check(uncached)).toEqual({ installed: undefined, available: nextCommit, mutable: true })
      expect(yield* Effect.promise(() => fs.readdir(path.join(cache, "packages")))).not.toContain(
        yield* Effect.promise(() => Npm.cacheKey(uncached)),
      )
      expect((yield* npm.resolve(uncached)).entrypoint).toBeUndefined()
      yield* npm.add(mutable, { refresh: true })
      return { mutable: mutableEntry, pinned: pinnedEntry }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(await Bun.file(path.join(first.mutable.directory, "index.js")).text()).toContain("root: true")
    expect(await Bun.file(path.join(first.pinned.directory, "index.js")).text()).toContain("root: true")

    const second = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return {
        mutable: yield* npm.add(mutable, { refresh: true }),
        pinned: yield* npm.add(pinned, { refresh: true }),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(await Bun.file(path.join(second.mutable.directory, "index.js")).text()).toContain('root: "second"')
    expect(await Bun.file(path.join(second.pinned.directory, "index.js")).text()).toContain("root: true")

    await fs.rename(fixture.repository, `${fixture.repository}-offline`)
    const offline = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      expect((yield* npm.resolve(mutable)).revision).toBe(second.mutable.revision)
      expect((yield* npm.check(mutable).pipe(Effect.flip))._tag).toBe("NpmInstallFailedError")
      return yield* npm.add(mutable, { refresh: true })
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(await Bun.file(path.join(offline.directory, "index.js")).text()).toContain('root: "second"')
  }, 30_000)
})

describe("Npm.resolve", () => {
  test("resolves a TUI entrypoint only when the package is already cached", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@1.0.0"
    const directory = path.join(cache, "packages", Npm.sanitize(spec), "node_modules", "fixture-plugin")
    const missing = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.resolve(spec, { subpaths: ["tui"] })
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(missing.entrypoint).toBeUndefined()

    await fs.mkdir(directory, { recursive: true })
    await writePackage(directory, {
      name: "fixture-plugin",
      exports: { ".": "./index.js", "./tui": "./tui.js" },
    })
    await Bun.write(path.join(directory, "index.js"), "export default {}\n")
    await Bun.write(path.join(directory, "tui.js"), "export default {}\n")

    const resolved = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.resolve(spec, { subpaths: ["tui"] })
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(resolved.entrypoint).toEndWith("/tui.js")
    expect(resolved.revision).toBe("1.0.0")
  })
})

describe("Npm.check and revision metadata", () => {
  test("checks registry tags, ranges, and exact pins without changing or installing packages", async () => {
    await using tmp = await tmpdir()
    await using registry = await createRegistryFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const spec = "@fixture/registry-plugin@latest"
    const range = "@fixture/registry-plugin@^1.0.0"
    const pinned = "@fixture/registry-plugin@1.0.0"
    const alias = "alias@npm:@fixture/registry-plugin@latest"
    const root = await registry.configure(cache, spec)
    const rangeRoot = await registry.configure(cache, range)
    const pinnedRoot = await registry.configure(cache, pinned)
    await registry.configure(cache, alias)
    await Effect.gen(function* () {
      const npm = yield* Npm.Service
      for (const unsupported of [registry.tarball, alias]) {
        const error = yield* npm.check(unsupported).pipe(Effect.flip)
        expect(error._tag).toBe("NpmInstallFailedError")
        expect(error.cause).toEqual(new Error("Package checks only support registry and Git package specs"))
      }
      expect(registry.state.requests).toBe(0)
      expect(registry.state.tarballRequests).toBe(0)
      expect((yield* npm.resolve(spec)).revision).toBeUndefined()
      const loaded = yield* npm.add(spec)
      expect(loaded.revision).toBe("1.0.0")
      const files = [
        "package.json",
        "package-lock.json",
        "node_modules/@fixture/registry-plugin/package.json",
        "node_modules/@fixture/registry-plugin/index.js",
      ]
      const before = yield* Effect.promise(() =>
        Promise.all(files.map((file) => Bun.file(path.join(root, file)).bytes())),
      )
      const requests = registry.state.tarballRequests
      expect(yield* npm.check(spec)).toEqual({ installed: "1.0.0", available: "1.0.0", mutable: true })
      registry.state.latest = "1.1.0"
      expect(yield* npm.check(spec)).toEqual({ installed: "1.0.0", available: "1.1.0", mutable: true })
      expect(yield* npm.check(range)).toEqual({ installed: undefined, available: "1.1.0", mutable: true })
      expect(yield* npm.check(pinned)).toEqual({ installed: undefined, available: "1.0.0", mutable: false })
      expect(yield* npm.add(spec)).toEqual(loaded)
      expect(yield* npm.resolve(spec)).toEqual(loaded)
      expect(
        yield* Effect.promise(() => Promise.all(files.map((file) => Bun.file(path.join(root, file)).bytes()))),
      ).toEqual(before)
      expect(registry.state.tarballRequests).toBe(requests)
      expect(yield* Effect.promise(() => fs.readdir(rangeRoot))).toEqual([".npmrc"])
      expect(yield* Effect.promise(() => fs.readdir(pinnedRoot))).toEqual([".npmrc"])

      registry.state.offline = true
      expect((yield* npm.check(spec).pipe(Effect.flip))._tag).toBe("NpmInstallFailedError")
      expect((yield* npm.resolve(spec)).revision).toBe("1.0.0")
      expect(yield* npm.add(spec)).toEqual(loaded)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
  }, 30_000)

  test("leaves unknown installed revisions undefined and prefers the wrapper Git lock", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const commit = "0123456789abcdef0123456789abcdef01234567"
    const spec = `git+https://example.com/fixture.git#${commit}`
    const root = path.join(cache, "packages", await Npm.cacheKey(spec))
    const directory = path.join(root, "node_modules", "fixture")
    await fs.mkdir(directory, { recursive: true })
    await writePackage(root, { dependencies: { fixture: spec } })
    await writePackage(directory, { name: "fixture", exports: "./index.js" })
    await Bun.write(path.join(directory, "index.js"), "export default {}\n")
    await Effect.gen(function* () {
      const npm = yield* Npm.Service
      expect((yield* npm.resolve(spec)).revision).toBeUndefined()
      expect((yield* npm.add(spec)).revision).toBeUndefined()
      const lock = (revision: string) =>
        JSON.stringify({
          packages: { "node_modules/fixture": { resolved: `git+https://example.com/fixture.git#${revision}` } },
        })
      yield* Effect.promise(() => Bun.write(path.join(root, "node_modules", ".package-lock.json"), lock(commit)))
      expect((yield* npm.resolve(spec)).revision).toBe(commit)
      const installed = "f".repeat(40)
      yield* Effect.promise(() => Bun.write(path.join(root, "package-lock.json"), lock(installed)))
      expect((yield* npm.resolve(spec)).revision).toBe(installed)
      yield* Effect.promise(() => fs.rm(directory, { recursive: true }))
      expect((yield* npm.resolve(spec)).revision).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
  })
})
