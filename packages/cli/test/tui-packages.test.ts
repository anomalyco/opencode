import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, FileSystem } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { filesystem } from "@opencode-ai/util/effect/app-node-platform"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { TuiPackages } from "../src/services/tui-packages"
import { tmpdir } from "./fixture/tmpdir"

const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]
const pluginManifest = (version: string) => ({
  name: "@fixture/plugin",
  version,
  type: "module",
  exports: { ".": "./tui.js", "./tui": "./tui.js" },
  dependencies: { "@fixture/esm": "^1.0.0", "@fixture/late": "^1.0.0" },
  scripts: { postinstall: "bun -e \"throw new Error('lifecycle scripts must not run')\"" },
})
const pluginSource = (version: string) => `
import { values, paths } from '@fixture/esm'
export const graph = { values: ['${version}', ...values], paths: [import.meta.url, ...paths] }
export const late = () => import('./late.js')
${version === "1.2.0" ? "throw new Error('failed import fixture')" : ""}
`

async function registryFixture(directory: string) {
  const packages = await Promise.all(
    versions.flatMap((version) =>
      ["plugin", "esm", "cjs", "leaf", "late"].map(async (name) => {
        const root = path.join(directory, "registry", name, version)
        const manifest =
          name === "plugin"
            ? pluginManifest(version)
            : {
                name: `@fixture/${name}`,
                version,
                type: ["cjs", "leaf"].includes(name) ? "commonjs" : "module",
                exports: "./index.js",
                dependencies:
                  name === "esm" ? { "@fixture/cjs": "^1.0.0" } : name === "cjs" ? { "@fixture/leaf": "^1.0.0" } : {},
              }
        await fs.mkdir(path.join(root, "package"), { recursive: true })
        await Bun.write(path.join(root, "package", "package.json"), JSON.stringify(manifest))
        const source =
          name === "plugin"
            ? pluginSource(version)
            : name === "esm"
              ? `import cjs from '@fixture/cjs'; export const values = ['${version}', ...cjs.values]; export const paths = [import.meta.url, ...cjs.paths]`
              : name === "cjs"
                ? `const leaf = require('@fixture/leaf'); module.exports = { values: ['${version}', ...leaf.values], paths: [__filename, ...leaf.paths] }`
                : name === "leaf"
                  ? `module.exports = { values: ['${version}'], paths: [__filename] }`
                  : `export const value = '${version}'; export const file = import.meta.url`
        await Bun.write(path.join(root, "package", name === "plugin" ? "tui.js" : "index.js"), source)
        if (name === "plugin")
          await Bun.write(path.join(root, "package", "late.js"), "export { value, file } from '@fixture/late'")
        await Bun.$`tar -czf package.tgz package`.cwd(root).quiet()
        return { name, manifest, tarball: await Bun.file(path.join(root, "package.tgz")).bytes() }
      }),
    ),
  )
  const state = { latest: "1.0.0", failTarballs: false }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const name = decodeURIComponent(url.pathname).replace("/@fixture/", "")
      const published = packages.filter(
        (pkg) => pkg.name === name && versions.indexOf(pkg.manifest.version) <= versions.indexOf(state.latest),
      )
      if (published.length)
        return Response.json(
          {
            name: `@fixture/${name}`,
            "dist-tags": { latest: state.latest },
            versions: Object.fromEntries(
              published.map((pkg) => [
                pkg.manifest.version,
                {
                  ...pkg.manifest,
                  dist: { tarball: `${url.origin}/${pkg.name}-${pkg.manifest.version}.tgz` },
                },
              ]),
            ),
          },
          { headers: { "cache-control": "no-cache" } },
        )
      const pkg = packages.find((pkg) => url.pathname === `/${pkg.name}-${pkg.manifest.version}.tgz`)
      return pkg && !state.failTarballs
        ? new Response(pkg.tarball)
        : new Response("missing fixture tarball", { status: 404 })
    },
  })
  return {
    state,
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

function resolverFixture(directory: string, options: { cache?: string } = {}) {
  const global = Global.make({
    ...Object.fromEntries(
      ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((key) => [
        key,
        path.join(directory, key),
      ]),
    ),
    ...options,
  })
  return Effect.gen(function* () {
    const npm = yield* Npm.Service
    const context = yield* Effect.context<Npm.Service | Global.Service | FileSystem.FileSystem>()
    return { npm, packages: yield* TuiPackages.make, cold: () => Effect.runPromiseWith(context)(TuiPackages.make) }
  }).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Npm.node, Global.node, filesystem]), [
        [Global.node, Global.layerWith(global)],
      ]),
    ),
    Effect.runPromise,
  )
}

async function snapshot(root: string) {
  const files = await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true, followSymlinks: true }),
  )
  return Promise.all(files.sort().map(async (file) => [file, await Bun.file(path.join(root, file)).bytes()]))
}

async function load(entry: { entrypoint?: string }) {
  if (!entry.entrypoint) throw new Error("Missing fixture entrypoint")
  const module: {
    graph: { values: string[]; paths: string[] }
    late: () => Promise<{ value: string; file: string }>
    local?: { value: string; file: string }
  } = await import(entry.entrypoint)
  return module
}

async function realpaths(files: string[]) {
  return Promise.all(files.map((file) => fs.realpath(file.startsWith("file:") ? new URL(file) : file)))
}

async function writeGitPackage(directory: string, version: string) {
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({
      ...pluginManifest(version),
      scripts: {},
      dependencies: { ...pluginManifest(version).dependencies, "@fixture/local": "file:./local" },
    }),
  )
  await Bun.write(path.join(directory, "tui.js"), `${pluginSource(version)}\nexport { local } from '@fixture/local'`)
  await Bun.write(path.join(directory, "late.js"), "export { value, file } from '@fixture/late'")
  await fs.mkdir(path.join(directory, "local"), { recursive: true })
  await Bun.write(
    path.join(directory, "local", "package.json"),
    JSON.stringify({
      name: "@fixture/local",
      version,
      type: "module",
      exports: "./index.js",
    }),
  )
  await Bun.write(
    path.join(directory, "local", "index.js"),
    `export const local = { value: '${version}', file: import.meta.url }`,
  )
}

test("registry updates isolate the whole graph and publish only after commit, including cold selection", async () => {
  await using tmp = await tmpdir()
  await using registry = await registryFixture(tmp.path)
  const cache = path.join(await fs.realpath(tmp.path), "cache")
  const spec = "@fixture/plugin@latest"
  const normalRoot = await registry.configure(cache, spec)
  const fixture = await resolverFixture(await fs.realpath(tmp.path))
  const one = await fixture.packages.resolve(spec)
  const old = await load(one)
  expect(old.graph.values).toEqual(Array(4).fill("1.0.0"))
  const before = await snapshot(normalRoot)
  registry.state.latest = "1.1.0"
  expect(await fixture.packages.check(spec)).toEqual({ installed: "1.0.0", available: "1.1.0", mutable: true })
  const two = await fixture.packages.update(spec)
  const fresh = await load(two)
  expect(two.revision).toBe("1.1.0")
  expect(fresh.graph.values).toEqual(Array(4).fill("1.1.0"))
  const oldPaths = await realpaths(old.graph.paths)
  const newPaths = await realpaths(fresh.graph.paths)
  expect(newPaths.every((file) => file.startsWith(path.join(cache, "tui-packages")))).toBe(true)
  expect(oldPaths.every((file) => !newPaths.includes(file))).toBe(true)
  expect(await old.late()).toMatchObject({ value: "1.0.0" })
  expect(await fresh.late()).toMatchObject({ value: "1.1.0" })
  expect((await realpaths([(await old.late()).file]))[0]).toStartWith(normalRoot)
  expect((await realpaths([(await fresh.late()).file]))[0]).toStartWith(path.join(cache, "tui-packages"))
  expect(await fixture.packages.resolve(spec)).toEqual(one)
  expect(await (await fixture.cold()).resolve(spec)).toEqual(one)
  expect((await fixture.packages.check(spec)).installed).toBe("1.0.0")
  expect(await snapshot(normalRoot)).toEqual(before)
  const selected = { entrypoint: two.entrypoint, revision: two.revision }
  await fixture.packages.commit(spec, selected)
  expect(await fixture.packages.resolve(spec)).toEqual(selected)
  expect(await (await fixture.cold()).resolve(spec)).toEqual(selected)
  expect(await fixture.packages.check(spec)).toEqual({ installed: "1.1.0", available: "1.1.0", mutable: true })
  expect(await fixture.packages.resolve(spec, false)).toEqual(one)
  expect(one).toEqual(await Effect.runPromise(fixture.npm.resolve(spec, { subpaths: ["tui"] })))
  expect(one).toEqual(await Effect.runPromise(fixture.npm.add(spec, { subpaths: ["tui"] })))
  expect(await snapshot(normalRoot)).toEqual(before)

  const selectedRoot = path.join(cache, "tui-packages", await Npm.cacheKey(spec))
  expect(await Bun.file(path.join(selectedRoot, "current.json")).json()).toEqual(selected)
  const pointer = await Bun.file(path.join(selectedRoot, "current.json")).bytes()
  registry.state.latest = "1.2.0"
  const broken = await fixture.packages.update(spec)
  await expect(load(broken)).rejects.toThrow("failed import fixture")
  expect(await Bun.file(path.join(broken.directory, "tui.js")).exists()).toBe(true)
  expect(await fixture.packages.resolve(spec)).toEqual(selected)
  expect(await Bun.file(path.join(selectedRoot, "current.json")).bytes()).toEqual(pointer)
  const staged = await fs.readdir(selectedRoot)
  registry.state.latest = "1.3.0"
  registry.state.failTarballs = true
  await expect(fixture.packages.update(spec)).rejects.toMatchObject({ code: "E404" })
  expect(await fs.readdir(selectedRoot)).toEqual(staged)
  expect(await fixture.packages.resolve(spec)).toEqual(selected)
  expect(await Bun.file(path.join(selectedRoot, "current.json")).bytes()).toEqual(pointer)
  expect(await snapshot(normalRoot)).toEqual(before)
}, 30_000)

test("Git branch updates use fresh ESM and CJS graphs, retain old late imports, and do not consume normal refresh", async () => {
  await using tmp = await tmpdir()
  await using registry = await registryFixture(tmp.path)
  const repository = path.join(tmp.path, "repository")
  await fs.mkdir(repository)
  await writeGitPackage(repository, "1.0.0")
  await Bun.$`git init -q -b fixture-branch ${repository}`.quiet()
  await Bun.$`git -C ${repository} add .`.quiet()
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm one`.quiet()
  const first = (await Bun.$`git -C ${repository} rev-parse HEAD`.text()).trim()
  const spec = `git+${pathToFileURL(repository).href}#fixture-branch`
  const pinned = `git+${pathToFileURL(repository).href}#${first}`
  const cache = path.join(await fs.realpath(tmp.path), "cache")
  const normalRoot = await registry.configure(cache, spec)
  await registry.configure(cache, pinned)
  const fixture = await resolverFixture(await fs.realpath(tmp.path))
  const one = await fixture.packages.resolve(spec)
  const old = await load(one)
  const before = await snapshot(normalRoot)
  await writeGitPackage(repository, "1.1.0")
  await Bun.$`git -C ${repository} add .`.quiet()
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm two`.quiet()
  const second = (await Bun.$`git -C ${repository} rev-parse HEAD`.text()).trim()
  registry.state.latest = "1.1.0"
  const two = await fixture.packages.update(spec)
  const fresh = await load(two)
  expect(one.revision).toBe(first)
  expect(two.revision).toBe(second)
  expect(old.graph.values).toEqual(Array(4).fill("1.0.0"))
  expect(fresh.graph.values).toEqual(Array(4).fill("1.1.0"))
  const oldPaths = await realpaths(old.graph.paths)
  const newPaths = await realpaths(fresh.graph.paths)
  expect(oldPaths.every((file) => !newPaths.includes(file))).toBe(true)
  expect(newPaths.every((file) => file.startsWith(path.join(cache, "tui-packages")))).toBe(true)
  expect(old.local?.value).toBe("1.0.0")
  expect(fresh.local?.value).toBe("1.1.0")
  const localPath = (await realpaths([fresh.local?.file ?? ""]))[0]
  expect(localPath).toStartWith(path.join(cache, "tui-packages"))
  expect((await fs.lstat(path.dirname(localPath))).isSymbolicLink()).toBe(false)
  expect(localPath).not.toBe((await realpaths([old.local?.file ?? ""]))[0])
  expect((await old.late()).value).toBe("1.0.0")
  expect((await fresh.late()).value).toBe("1.1.0")
  expect(await fixture.packages.resolve(spec)).toEqual(one)
  expect(await (await fixture.cold()).resolve(spec)).toEqual(one)
  await fixture.packages.commit(spec, two)
  expect(await (await fixture.cold()).resolve(spec)).toEqual({ entrypoint: two.entrypoint, revision: two.revision })
  expect(await fixture.packages.resolve(spec, false)).toEqual(one)
  expect(await fixture.packages.check(spec)).toEqual({ installed: second, available: second, mutable: true })
  expect(await snapshot(normalRoot)).toEqual(before)
  await expect(fixture.packages.update(pinned)).rejects.toThrow("Pinned packages cannot be updated")
  expect(await fs.readdir(path.join(cache, "tui-packages"))).toEqual([await Npm.cacheKey(spec)])
  const pinnedEntry = await Effect.runPromise(
    fixture.npm.add(pinned, { root: path.join(await fs.realpath(tmp.path), "pinned"), subpaths: ["tui"] }),
  )
  expect(pinnedEntry.revision).toBe(first)
  expect((await load(pinnedEntry)).graph.values[0]).toBe("1.0.0")
  expect((await Effect.runPromise(fixture.npm.add(spec, { refresh: true, subpaths: ["tui"] }))).revision).toBe(second)
}, 30_000)

test("pins and unsupported specs do not stage or select, and fresh registry pins stay exact", async () => {
  await using tmp = await tmpdir()
  await using registry = await registryFixture(tmp.path)
  const cache = path.join(await fs.realpath(tmp.path), "cache")
  const spec = "@fixture/plugin@1.0.0"
  const root = await registry.configure(cache, spec)
  const fixture = await resolverFixture(await fs.realpath(tmp.path))
  const one = await fixture.packages.resolve(spec)
  const before = await snapshot(root)
  registry.state.latest = "1.1.0"
  await expect(fixture.packages.update(spec)).rejects.toThrow("Pinned packages cannot be updated")
  for (const unsupported of ["./local", "https://example.test/plugin.tgz", "alias@npm:@fixture/plugin@latest"])
    await expect(fixture.packages.update(unsupported)).rejects.toThrow(
      "Package checks only support registry and Git package specs",
    )
  expect(await fs.readdir(cache)).not.toContain("tui-packages")
  expect(await fixture.packages.resolve(spec)).toEqual(one)
  expect(await snapshot(root)).toEqual(before)
  const pinned = await Effect.runPromise(
    fixture.npm.add(spec, { root: path.join(tmp.path, "pinned"), subpaths: ["tui"] }),
  )
  expect(pinned.revision).toBe("1.0.0")
  expect((await load(pinned)).graph.values[0]).toBe("1.0.0")
  expect(await snapshot(root)).toEqual(before)
})

test("independent terminals commit last-writer-wins without deleting either successful graph", async () => {
  await using tmp = await tmpdir()
  await using registry = await registryFixture(tmp.path)
  const spec = "@fixture/plugin@latest"
  const cache = path.join(await fs.realpath(tmp.path), "cache")
  await registry.configure(cache, spec)
  const fixture = await resolverFixture(await fs.realpath(tmp.path))
  const other = await fixture.cold()
  const [first, second] = await Promise.all([fixture.packages.update(spec), other.update(spec)])
  expect(first.entrypoint).not.toBe(second.entrypoint)
  await fixture.packages.commit(spec, first)
  await other.commit(spec, second)
  expect(await (await fixture.cold()).resolve(spec)).toEqual({
    entrypoint: second.entrypoint,
    revision: second.revision,
  })
  expect((await load(first)).graph.values).toEqual(Array(4).fill("1.0.0"))
  expect((await load(second)).graph.values).toEqual(Array(4).fill("1.0.0"))
  const selected = path.join(cache, "tui-packages", await Npm.cacheKey(spec))
  expect((await fs.readdir(selected)).filter((file) => file.endsWith(".tmp"))).toEqual([])
})

test("symlink cache aliases resolve normally and prepare canonical Git and registry graphs", async () => {
  await using tmp = await tmpdir()
  const directory = await fs.realpath(tmp.path)
  await using registry = await registryFixture(directory)
  const repository = path.join(directory, "repository")
  await fs.mkdir(repository)
  await writeGitPackage(repository, "1.0.0")
  await Bun.$`git init -q -b fixture-branch ${repository}`.quiet()
  await Bun.$`git -C ${repository} add .`.quiet()
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm one`.quiet()
  const cache = path.join(directory, "cache")
  const alias = path.join(directory, "cache-alias")
  await fs.mkdir(cache)
  await fs.symlink(cache, alias, "junction")
  const normal = await resolverFixture(directory)
  const aliased = await resolverFixture(directory, { cache: alias })
  const installed = await Promise.all(
    [`git+${pathToFileURL(repository).href}#fixture-branch`, "@fixture/plugin@latest"].map(async (spec) => {
      await registry.configure(alias, spec)
      const entry = await normal.packages.resolve(spec)
      expect(await aliased.packages.resolve(spec)).toMatchObject({
        entrypoint: entry.entrypoint,
        revision: entry.revision,
      })
      expect(await aliased.packages.resolve(spec, false)).toMatchObject({
        entrypoint: entry.entrypoint,
        revision: entry.revision,
      })
      return { spec, entry, module: await load(entry) }
    }),
  )
  const before = await snapshot(path.join(cache, "packages"))
  await writeGitPackage(repository, "1.1.0")
  await Bun.$`git -C ${repository} add .`.quiet()
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm two`.quiet()
  registry.state.latest = "1.1.0"
  for (const old of installed) {
    const entry = await aliased.packages.update(old.spec)
    const fresh = await load(entry)
    expect(entry.directory).toStartWith(path.join(cache, "tui-packages"))
    expect(fresh.graph.values).toEqual(Array(4).fill("1.1.0"))
    const oldPaths = await realpaths(old.module.graph.paths)
    const freshPaths = await realpaths(fresh.graph.paths)
    expect(
      freshPaths.every((file) => file.startsWith(path.join(cache, "tui-packages")) && !oldPaths.includes(file)),
    ).toBe(true)
    expect((await old.module.late()).value).toBe("1.0.0")
    expect((await fresh.late()).value).toBe("1.1.0")
    expect((await aliased.packages.resolve(old.spec)).revision).toBe(old.entry.revision)
    expect(await snapshot(path.join(cache, "packages"))).toEqual(before)
    const selected = { entrypoint: entry.entrypoint, revision: entry.revision }
    await aliased.packages.commit(old.spec, selected)
    expect(await (await aliased.cold()).resolve(old.spec)).toEqual(selected)
    expect(await (await normal.cold()).resolve(old.spec)).toEqual(selected)
    expect((await aliased.packages.check(old.spec)).installed).toBe(entry.revision)
    expect((await aliased.packages.resolve(old.spec, false)).revision).toBe(old.entry.revision)
    expect(
      await Bun.file(path.join(alias, "tui-packages", await Npm.cacheKey(old.spec), "current.json")).json(),
    ).toEqual(selected)
    expect(await snapshot(path.join(cache, "packages"))).toEqual(before)
  }
  expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true)
}, 30_000)
