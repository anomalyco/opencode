import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { withEnv } from "./fixture/env"
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
  AppNodeBuilder.build(LayerNode.group([Npm.node, EffectFlock.node]), [
    Global.node.replace(Global.layerWith({ cache, state: path.join(cache, "state") })),
  ])

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
  const state = { latest: "1.0.0", audits: 0 }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/-/npm/v1/security/")) {
        state.audits++
        return Response.json({})
      }
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
        `registry=${server.url}\n@fixture:registry=${server.url}\ncache=${path.join(directory, "npm-cache")}\nfetch-retries=0\naudit=true\n`,
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
    await fs.mkdir(path.join(tmp.path, "cache", "npm", Npm.sanitize(spec)), { recursive: true })

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

  test.each(["commit", "branch"])("installs a Git package from an npm ::path: subdirectory at a %s", async (ref) => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const spec = `git+file://${fixture.repository}#${ref === "commit" ? fixture.commit : "fixture-branch"}::path:packages/subdirectory-plugin`
    const result = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return { added: yield* npm.add(spec), outdated: yield* npm.check(spec) }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(result.added.directory).toEndWith(path.join("node_modules", "fixture-subdirectory-plugin"))
    expect(result.added.name).toBe("fixture-subdirectory-plugin")
    expect(result.added.version).toBe(fixture.commit)
    expect(await Bun.file(path.join(result.added.directory, "index.js")).text()).toContain("subdirectory: true")
    expect(
      await fs.stat(path.join(path.dirname(result.added.directory), "fixture-subdirectory-dependency", "package.json")),
    ).toBeTruthy()
    expect(result.outdated).toBeFalse()
  })

  // Several real Git installs and updates exceed Bun's default timeout on Windows.
  test("checks and updates mutable Git packages without changing pinned installs", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const repository = pathToFileURL(fixture.repository).href
    const mutable = `git+${repository}#fixture-branch`
    const pinned = `git+${repository}#${fixture.commit}`

    const result = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      const mutableEntry = yield* npm.add(mutable)
      yield* npm.add(pinned)
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

  test("rejects only the newest installed version, keeping its files for what still runs it", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    const mutable = `git+${pathToFileURL(fixture.repository).href}#fixture-branch`

    const result = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      const first = yield* npm.add(mutable)
      const alone = yield* npm.reject(mutable, first.version ?? "")
      yield* Effect.promise(async () => {
        await Bun.write(path.join(fixture.repository, "index.js"), 'export default { root: "second" }\n')
        await Bun.$`git -C ${fixture.repository} add .`
        await Bun.$`git -C ${fixture.repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm second`
      })
      const second = yield* npm.update(mutable)
      const other = yield* npm.reject(mutable, first.version ?? "")
      const rejected = yield* npm.reject(mutable, second.version ?? "")
      const current = yield* npm.resolve(mutable)
      return {
        alone,
        other,
        rejected,
        current: yield* Effect.promise(() => Bun.file(path.join(current.directory, "index.js")).text()),
        kept: yield* Effect.promise(() => Bun.file(path.join(second.directory, "index.js")).exists()),
      }
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)
    expect(result).toMatchObject({ alone: false, other: false, rejected: true, kept: true })
    expect(result.current).toContain("root: true")
  }, 30_000)

  test("reports Git's own error when a Git package cannot be fetched", async () => {
    await using tmp = await tmpdir()
    const spec = `git+${pathToFileURL(path.join(tmp.path, "missing")).href}`

    const error = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec).pipe(Effect.flip)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(error.message).toContain(`Failed to install ${spec}`)
    expect(error.message).toContain("does not appear to be a git repository")
  }, 30_000)

  // Symlink creation needs elevated privileges on Windows.
  test.skipIf(win)("records Git revisions when the cache directory is reached through a symlink", async () => {
    await using tmp = await tmpdir()
    const fixture = await createGitFixture(tmp.path)
    await fs.mkdir(path.join(tmp.path, "cache"))
    await fs.symlink(path.join(tmp.path, "cache"), path.join(tmp.path, "link"))
    const mutable = `git+${pathToFileURL(fixture.repository).href}#fixture-branch`

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
  }, 30_000)

  test("fails fast on 401 Git auth with non-interactive env and respects core.sshCommand", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const captureFile = path.join(tmp.path, "helper-env.json")
    const helperScript = path.join(tmp.path, "credential-helper.js")
    const gitConfig = path.join(tmp.path, "gitconfig")

    // Simulates Git Credential Manager honoring GCM_INTERACTIVE=never instead of blocking on a browser login.
    await Bun.write(
      helperScript,
      `const fs = require("node:fs")
fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({
  GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT,
  GCM_INTERACTIVE: process.env.GCM_INTERACTIVE,
  GIT_ASKPASS: process.env.GIT_ASKPASS,
  SSH_ASKPASS: process.env.SSH_ASKPASS,
  SSH_ASKPASS_REQUIRE: process.env.SSH_ASKPASS_REQUIRE,
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
}))
if (process.env.GCM_INTERACTIVE === "never") {
  process.stderr.write("fatal: interactive authentication disabled\\n")
  process.exit(1)
}
setInterval(() => {}, 1000)
`,
    )
    const helperCmd = `!"${process.execPath.replaceAll("\\", "/")}" "${helperScript.replaceAll("\\", "/")}"`
    await Bun.write(gitConfig, `[credential]\n\thelper = \n\thelper = ${helperCmd}\n`)

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="private"' },
        })
      },
    })

    try {
      const spec = `git+http://127.0.0.1:${server.port}/org/private-plugin.git`
      const error = await withEnv(
        {
          GIT_CONFIG_GLOBAL: gitConfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_SSH_COMMAND: undefined,
          GIT_ASKPASS: "/nonexistent/interactive-askpass",
          GCM_INTERACTIVE: "always",
        },
        () =>
          Effect.gen(function* () {
            const npm = yield* Npm.Service
            return yield* npm.add(spec).pipe(Effect.flip)
          }),
      ).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

      expect(error).toBeInstanceOf(Npm.InstallFailedError)
      expect(error.message).toContain(`Failed to install ${spec}`)
      expect(error.message).toContain("interactive authentication disabled")

      const captured = await Bun.file(captureFile).json()
      expect(captured).toEqual({
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        SSH_ASKPASS_REQUIRE: "never",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
      })

      // When core.sshCommand is configured in git config, GIT_SSH_COMMAND must stay unset so git uses it.
      await Bun.write(
        gitConfig,
        `[core]\n\tsshCommand = ssh -i /custom/key\n[credential]\n\thelper = \n\thelper = ${helperCmd}\n`,
      )
      await withEnv(
        {
          GIT_CONFIG_GLOBAL: gitConfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_SSH_COMMAND: undefined,
        },
        () =>
          Effect.gen(function* () {
            const npm = yield* Npm.Service
            return yield* npm.add(spec).pipe(Effect.flip)
          }),
      ).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

      const capturedCustom = await Bun.file(captureFile).json()
      expect(capturedCustom.GIT_SSH_COMMAND).toBeUndefined()
    } finally {
      await server.stop(true)
    }
  }, 30_000)

  test("times out a hung Git install, removes staging, and releases the lock", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const arrived = Deferred.makeUnsafe<void>()

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        Deferred.doneUnsafe(arrived, Effect.succeed(undefined))
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
        })
      },
    })

    try {
      const spec = `git+http://127.0.0.1:${server.port}/org/hung-plugin.git`
      const pkgDir = path.join(cache, "npm", await Npm.cacheKey(spec))

      const error = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        const fiber = yield* npm.add(spec).pipe(Effect.flip, Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(arrived)
        yield* TestClock.adjust("2 minutes")
        const err = yield* Fiber.join(fiber)
        const flock = yield* EffectFlock.Service
        yield* Effect.scoped(flock.acquire(`npm-install:${pkgDir}`, undefined, { timeoutMs: 1_000 }))
        return err
      }).pipe(
        Effect.scoped,
        Effect.provide(npmLayer(cache)),
        Effect.provide(TestClock.layer()),
        Effect.runPromise,
      )

      expect(error).toBeInstanceOf(Npm.InstallFailedError)
      expect(error.message).toContain(`Failed to install ${spec}`)
      expect(error.message).toContain("Timed out after 2m")

      const entries = await fs.readdir(pkgDir).catch(() => [] as string[])
      expect(entries.filter((entry) => entry.startsWith(".staging-"))).toEqual([])
    } finally {
      await server.stop(true)
    }
  }, 30_000)

  test("interrupting a hung Git install cleans staging and releases the lock", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const arrived = Deferred.makeUnsafe<void>()

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        Deferred.doneUnsafe(arrived, Effect.succeed(undefined))
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
        })
      },
    })

    try {
      const spec = `git+http://127.0.0.1:${server.port}/org/interrupted-plugin.git`
      const pkgDir = path.join(cache, "npm", await Npm.cacheKey(spec))

      await Effect.gen(function* () {
        const npm = yield* Npm.Service
        const fiber = yield* npm.add(spec).pipe(Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(arrived).pipe(Effect.timeout("5 seconds"))
        yield* Fiber.interrupt(fiber)
        const flock = yield* EffectFlock.Service
        yield* Effect.scoped(flock.acquire(`npm-install:${pkgDir}`, undefined, { timeoutMs: 1_000 }))
      }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

      const entries = await fs.readdir(pkgDir).catch(() => [] as string[])
      expect(entries.filter((entry) => entry.startsWith(".staging-"))).toEqual([])
    } finally {
      await server.stop(true)
    }
  }, 30_000)

  test("times out a hung Git update check", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const arrived = Deferred.makeUnsafe<void>()

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        Deferred.doneUnsafe(arrived, Effect.succeed(undefined))
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
        })
      },
    })

    try {
      const spec = `git+http://127.0.0.1:${server.port}/org/hung-check.git#main`
      const generation = path.join(cache, "npm", await Npm.cacheKey(spec), "1000")
      await fs.mkdir(path.join(generation, "node_modules", "hung-check"), { recursive: true })
      await Bun.write(path.join(generation, "package.json"), JSON.stringify({ dependencies: { "hung-check": spec } }))
      await Bun.write(
        path.join(generation, "package-lock.json"),
        JSON.stringify({
          packages: {
            "node_modules/hung-check": {
              resolved: `git+http://127.0.0.1:${server.port}/org/hung-check.git#0123456789abcdef0123456789abcdef01234567`,
            },
          },
        }),
      )

      const error = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        const fiber = yield* npm.check(spec).pipe(Effect.flip, Effect.forkChild({ startImmediately: true }))
        yield* Deferred.await(arrived)
        yield* TestClock.adjust("30 seconds")
        return yield* Fiber.join(fiber)
      }).pipe(
        Effect.scoped,
        Effect.provide(npmLayer(cache)),
        Effect.provide(TestClock.layer()),
        Effect.runPromise,
      )

      expect(error).toBeInstanceOf(Npm.InstallFailedError)
      expect(error.message).toContain("Timed out after 30s")
    } finally {
      await server.stop(true)
    }
  }, 30_000)
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
  test("installs and updates without requesting registry audits", async () => {
    await using tmp = await tmpdir()
    await using registry = await createRegistryFixture(tmp.path)
    const cache = path.join(tmp.path, "cache")
    const spec = "@fixture/registry-plugin@latest"
    await registry.configure(cache, spec)

    await Effect.gen(function* () {
      const npm = yield* Npm.Service
      expect((yield* npm.add(spec)).version).toBe("1.0.0")
      expect(registry.state.audits).toBe(0)

      registry.state.latest = "1.1.0"
      expect((yield* npm.update(spec)).version).toBe("1.1.0")
      expect(registry.state.audits).toBe(0)
      expect((yield* npm.resolve(spec)).version).toBe("1.1.0")
    }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)
  })

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
