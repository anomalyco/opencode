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
  AppNodeBuilder.build(Npm.node, [Global.node.replace(Global.layerWith({ cache, state: path.join(cache, "state") }))])

// Keep local installs independent of the public npm security-audit endpoint.
async function disableAudit(cache: string, ...specs: string[]) {
  for (const spec of specs) {
    const root = path.join(cache, "npm", await Npm.cacheKey(spec))
    await fs.mkdir(root, { recursive: true })
    await Bun.write(path.join(root, ".npmrc"), "audit=false\n")
  }
}

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
    await Bun.$`tar -czf package.tgz package`.cwd(root)
    tarballs.set(version, await Bun.file(path.join(root, "package.tgz")).bytes())
  }
  const state = { latest: "1.0.0" }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
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
      const tarball = tarballs.get(url.pathname.slice(1).replace(".tgz", ""))
      return tarball ? new Response(tarball) : new Response("missing", { status: 404 })
    },
  })
  return {
    state,
    async configure(cache: string, spec: string) {
      const root = path.join(cache, "npm", await Npm.cacheKey(spec))
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
  test("canonicalizes registry keys and hashes Git specs", async () => {
    expect(await Npm.cacheKey("@opencode/acme@1.0.0")).toBe(Npm.sanitize("@opencode/acme@1.0.0"))
    expect(await Npm.cacheKey("plugin")).toBe(Npm.sanitize("plugin@latest"))
    expect(await Npm.cacheKey("@opencode/acme")).toBe(Npm.sanitize("@opencode/acme@latest"))
    const spec = "git+ssh://git@github.com/acme/plugin.git#main"
    expect(await Npm.cacheKey(spec)).toMatch(/^git-plugin-[a-f0-9]{12}$/)
    expect(await Npm.cacheKey(spec)).toBe(await Npm.cacheKey(spec))
    expect(await Npm.cacheKey(`${spec}-other`)).not.toBe(await Npm.cacheKey(spec))
  })
})

describe("Npm.add", () => {
  test("locates cached scoped package specs without reifying", async () => {
    await using tmp = await tmpdir()
    const spec = "@fixture/provider@1.0.0"
    const directory = path.join(
      tmp.path,
      "cache",
      "npm",
      await Npm.cacheKey(spec),
      "1000",
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
    expect(entry.name).toBe("@fixture/provider")
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
    await disableAudit(path.join(tmp.path, "cache"), spec)

    const entries = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return {
        added: yield* npm.add(spec),
        cached: yield* npm.add(spec),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(await fs.stat(path.join(entries.added.directory, "package.json"))).toBeTruthy()
    expect(entries.cached).toEqual(entries.added)
  })

  test.each(["unnamed", "named"])("installs and locates %s Git packages with dependencies", async (kind) => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const spec =
      kind === "unnamed"
        ? `git+file://${fixture.repository}#${fixture.commit}`
        : `fixture-named-plugin@git+file://${fixture.repository}#fixture-branch`
    await disableAudit(path.join(tmp.path, "cache"), spec)

    const entries = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return {
        added: yield* npm.add(spec),
        cached: yield* npm.add(spec),
        resolved: yield* npm.resolve(spec),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entries.added.directory).toEndWith(path.join("node_modules", entries.added.name))
    expect(entries.added.version).toBe(fixture.commit)
    expect(entries.cached).toEqual(entries.added)
    expect(entries.resolved).toEqual(entries.added)
    expect(
      await fs.stat(path.join(path.dirname(entries.added.directory), "fixture-dependency", "package.json")),
    ).toBeTruthy()
    expect(entries.added.directory).toContain(path.join("npm", await Npm.cacheKey(spec)))
    expect(entries.added.directory).toContain("node_modules")
  })

  test("installs a Git package from an npm ::path: subdirectory", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const spec = `git+file://${fixture.repository}#${fixture.commit}::path:packages/subdirectory-plugin`
    await disableAudit(path.join(tmp.path, "cache"), spec)
    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(entry.directory).toEndWith(path.join("node_modules", "fixture-subdirectory-plugin"))
    expect(entry.name).toBe("fixture-subdirectory-plugin")
    expect(
      await fs.stat(path.join(path.dirname(entry.directory), "fixture-subdirectory-dependency", "package.json")),
    ).toBeTruthy()
  })

  // Several real Git installs and updates exceed Bun's default timeout on Windows.
  test("checks and updates mutable Git packages without changing pinned installs", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const repository = pathToFileURL(fixture.repository).href
    const mutable = `git+${repository}#fixture-branch`
    const pinned = `git+${repository}#${fixture.commit}`
    await disableAudit(cache, mutable, pinned)

    const result = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      const mutableEntry = yield* npm.add(mutable)
      const pinnedEntry = yield* npm.add(pinned)
      yield* Effect.promise(async () => {
        await Bun.write(path.join(fixture.repository, "index.js"), 'export default { root: "second" }\n')
        await Bun.$`git -C ${fixture.repository} add .`
        await Bun.$`git -C ${fixture.repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm second`
      })
      const before = yield* Effect.promise(() => Bun.file(path.join(mutableEntry.directory, "index.js")).text())
      const outdated = yield* npm.check(mutable)
      const pinnedOutdated = yield* npm.check(pinned)
      const unchanged = yield* Effect.promise(() => Bun.file(path.join(mutableEntry.directory, "index.js")).text())
      const updated = yield* npm.update(mutable)
      const pinnedUpdated = yield* npm.update(pinned)
      return {
        before,
        outdated,
        pinnedOutdated,
        unchanged,
        updated: yield* Effect.promise(() => Bun.file(path.join(updated.directory, "index.js")).text()),
        pinned: yield* Effect.promise(() => Bun.file(path.join(pinnedUpdated.directory, "index.js")).text()),
        current: yield* npm.check(mutable),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(result.before).toContain("root: true")
    expect(result.outdated).toBeTrue()
    expect(result.pinnedOutdated).toBeFalse()
    expect(result.unchanged).toContain("root: true")
    expect(result.updated).toContain('root: "second"')
    expect(result.pinned).toContain("root: true")
    expect(result.current).toBeFalse()
  }, 30_000)

  // Symlink creation needs elevated privileges on Windows.
  test.skipIf(win)(
    "records Git revisions when the cache directory is reached through a symlink",
    async () => {
      await using tmp = await tmpdir()
      const fixture = await createGitFixture(tmp.path)
      await fs.mkdir(path.join(tmp.path, "cache"))
      await fs.symlink(path.join(tmp.path, "cache"), path.join(tmp.path, "link"))
      const mutable = `git+${pathToFileURL(fixture.repository).href}#fixture-branch`
      await disableAudit(path.join(tmp.path, "link"), mutable)

      const result = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        const added = yield* npm.add(mutable)
        const current = yield* npm.check(mutable)
        yield* Effect.promise(async () => {
          await Bun.write(path.join(fixture.repository, "index.js"), 'export default { root: "second" }\n')
          await Bun.$`git -C ${fixture.repository} add .`
          await Bun.$`git -C ${fixture.repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm second`
        })
        return { added, current, outdated: yield* npm.check(mutable) }
      }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "link"))), Effect.runPromise)

      expect(result.added.version).toBe(fixture.commit)
      expect(result.current).toBeFalse()
      expect(result.outdated).toBeTrue()
    },
    30_000,
  )
})

describe("Npm.resolve", () => {
  test("locates a cached package without installing it", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const spec = "fixture-plugin@1.0.0"
    const directory = path.join(cache, "npm", Npm.sanitize(spec), "1000", "node_modules", "fixture-plugin")
    const missing = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.resolve(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(missing.version).toBeUndefined()

    await fs.mkdir(directory, { recursive: true })
    await writePackage(directory, {
      name: "fixture-plugin",
      exports: { ".": "./index.js", "./tui": "./tui.js" },
    })
    await Bun.write(path.join(directory, "index.js"), "export default {}\n")
    await Bun.write(path.join(directory, "tui.js"), "export default {}\n")

    const resolved = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.resolve(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(resolved.directory).toBe(directory)
    expect(resolved.version).toBe("1.0.0")
  })
})

describe("Npm.check and Npm.update", () => {
  test("checks a mutable registry target without mutation and explicitly updates it", async () => {
    await using tmp = await tmpdir()
    await using registry = await createRegistryFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const mutable = "@fixture/registry-plugin@latest"
    const root = await registry.configure(cache, mutable)

    const result = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      const installed = yield* npm.add(mutable)
      const current = yield* npm.check(mutable)
      registry.state.latest = "1.1.0"
      const outdated = yield* npm.check(mutable)
      const before = yield* Effect.promise(() => Bun.file(path.join(installed.directory, "index.js")).text())
      yield* Effect.promise(() => Promise.all([fs.mkdir(path.join(root, "1")), fs.mkdir(path.join(root, "2"))]))
      const updated = yield* npm.update(mutable)
      const unchanged = yield* npm.update(mutable)
      return {
        current,
        outdated,
        before,
        after: yield* Effect.promise(() => Bun.file(path.join(updated.directory, "index.js")).text()),
        version: updated.version,
        changedDirectory: installed.directory !== updated.directory,
        unchangedDirectory: unchanged.directory === updated.directory,
        generations: yield* Effect.promise(() => fs.readdir(root)),
        updated: yield* npm.check(mutable),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    expect(result.current).toBeFalse()
    expect(result.outdated).toBeTrue()
    expect(result.before).toContain('version = "1.0.0"')
    expect(result.after).toContain('version = "1.1.0"')
    expect(result.version).toBe("1.1.0")
    expect(result.changedDirectory).toBeTrue()
    expect(result.unchangedDirectory).toBeTrue()
    expect(result.generations).not.toContain("1")
    expect(result.generations).not.toContain("2")
    expect(result.updated).toBeFalse()
  })

  test("never reports a pinned registry target as outdated", async () => {
    await using tmp = await tmpdir()
    await using registry = await createRegistryFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const pinned = "@fixture/registry-plugin@1.0.0"
    await registry.configure(cache, pinned)

    const outdated = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      yield* npm.add(pinned)
      registry.state.latest = "1.1.0"
      return yield* npm.check(pinned)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

    expect(outdated).toBeFalse()
  })
})
