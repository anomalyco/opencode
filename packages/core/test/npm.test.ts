import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { NpmEntrypoint } from "@opencode-ai/core/npm-entrypoint"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
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
  Npm.layer.pipe(
    Layer.provide(EffectFlock.layer),
    Layer.provide(FSUtil.layer),
    Layer.provide(Global.layerWith({ cache, state: path.join(cache, "state") })),
    Layer.provide(NodeFileSystem.layer),
  )

const writePackageFixture = async (dir: string, pkg: Record<string, unknown>, files: Record<string, string>) => {
  await fs.mkdir(dir, { recursive: true })
  await writePackage(dir, pkg)
  await Promise.all(
    Object.entries(files).map(async ([file, contents]) => {
      const filePath = path.join(dir, file)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await Bun.write(filePath, contents)
    }),
  )
}

const addPackage = (cache: string, spec: string) =>
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    return yield* npm.add(spec)
  }).pipe(Effect.scoped, Effect.provide(npmLayer(cache)), Effect.runPromise)

const addLocalPackage = (root: string, name: string, dir: string) =>
  addPackage(path.join(root, "cache"), `${name}@file:${dir}`)

const expectEntryPoint = (entry: { entrypoint: Option.Option<string> }) => {
  expect(Option.isSome(entry.entrypoint)).toBe(true)
  if (Option.isNone(entry.entrypoint)) throw new Error("entrypoint was not resolved")
  return entry.entrypoint.value
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

describe("Npm.add", () => {
  test("reifies when package cache directory exists without the package installed", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "fixture-provider"),
      {
        name: "fixture-provider",
        main: "index.js",
      },
      {
        "index.js": "export const fixture = true\n",
      },
    )

    const spec = `fixture-provider@file:${path.join(tmp.path, "fixture-provider")}`
    await fs.mkdir(path.join(tmp.path, "cache", "packages", Npm.sanitize(spec)), { recursive: true })

    const entry = await addPackage(path.join(tmp.path, "cache"), spec)

    expect(Option.isSome(entry.entrypoint)).toBe(true)
  })

  test("resolves ESM package exports to an importable file entrypoint", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "fixture-provider"),
      {
        name: "fixture-provider",
        type: "module",
        exports: "./dist/index.js",
      },
      {
        "dist/index.js": "export const createFixture = () => ({ languageModel: () => undefined })\n",
      },
    )

    const entry = await addLocalPackage(tmp.path, "fixture-provider", path.join(tmp.path, "fixture-provider"))

    const entrypoint = expectEntryPoint(entry)
    expect(entrypoint).toEndWith("/dist/index.js")
    await expect(import(entrypoint)).resolves.toHaveProperty("createFixture")
  })

  test("resolves scoped ESM package exports", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "scoped-provider"),
      {
        name: "@scope/fixture.provider-name",
        type: "module",
        exports: "./dist/index.js",
      },
      {
        "dist/index.js": "export const createScopedFixture = () => ({ languageModel: () => undefined })\n",
      },
    )

    const entry = await addLocalPackage(tmp.path, "@scope/fixture.provider-name", path.join(tmp.path, "scoped-provider"))

    const entrypoint = expectEntryPoint(entry)
    expect(entrypoint).toEndWith("/dist/index.js")
    await expect(import(entrypoint)).resolves.toHaveProperty("createScopedFixture")
  })
})

describe("NpmEntrypoint.resolveManual", () => {
  test("resolves legacy main entrypoints", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "node_modules", "legacy-provider")
    await writePackageFixture(
      dir,
      {
        name: "legacy-provider",
        type: "module",
        main: "index.js",
      },
      {
        "index.js": "export const selected = 'legacy'\n",
      },
    )

    const entrypoint = expectEntryPoint(NpmEntrypoint.resolveManual("legacy-provider", dir))

    expect(entrypoint).toEndWith("/index.js")
    expect((await import(entrypoint)).selected).toBe("legacy")
  })

  const conditionalExportFixtures: Array<{
    name: string
    folder: string
    exports: unknown
    files: Record<string, string>
    suffix: string
    selected: string
  }> = [
    {
      name: "resolves import-only conditional exports",
      folder: "conditional-provider",
      exports: { ".": { import: "./dist/index.js" } },
      files: { "dist/index.js": "export const selected = 'import'\n" },
      suffix: "/dist/index.js",
      selected: "import",
    },
    {
      name: "resolves export array targets in order",
      folder: "array-provider",
      exports: ["./dist/first.js", "./dist/second.js"],
      files: {
        "dist/first.js": "export const selected = 'first'\n",
        "dist/second.js": "export const selected = 'second'\n",
      },
      suffix: "/dist/first.js",
      selected: "first",
    },
    {
      name: "skips invalid export array alternatives",
      folder: "array-fallback-provider",
      exports: [null, "./%2e%2e/outside.js", "./dist/index.js"],
      files: { "dist/index.js": "export const selected = 'index'\n" },
      suffix: "/dist/index.js",
      selected: "index",
    },
    {
      name: "resolves conditional exports in package key order",
      folder: "ordered-provider",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          node: "./dist/node.js",
          import: "./dist/import.js",
          default: "./dist/default.js",
        },
      },
      files: {
        "dist/node.js": "export const selected = 'node'\n",
        "dist/import.js": "export const selected = 'import'\n",
        "dist/default.js": "export const selected = 'default'\n",
      },
      suffix: "/dist/node.js",
      selected: "node",
    },
    {
      name: "resolves default before node when package order says so",
      folder: "default-first-provider",
      exports: { ".": { default: "./dist/default.js", node: "./dist/node.js" } },
      files: {
        "dist/default.js": "export const selected = 'default'\n",
        "dist/node.js": "export const selected = 'node'\n",
      },
      suffix: "/dist/default.js",
      selected: "default",
    },
    {
      name: "skips require condition for dynamic imports",
      folder: "require-provider",
      exports: {
        ".": {
          require: "./dist/require.js",
          import: "./dist/import.js",
          default: "./dist/default.js",
        },
      },
      files: {
        "dist/require.js": "export const selected = 'require'\n",
        "dist/import.js": "export const selected = 'import'\n",
        "dist/default.js": "export const selected = 'default'\n",
      },
      suffix: "/dist/import.js",
      selected: "import",
    },
    {
      name: "resolves the node-addons export condition when it is first",
      folder: "node-addons-provider",
      exports: {
        ".": {
          "node-addons": "./dist/node-addons.js",
          node: "./dist/node.js",
          import: "./dist/import.js",
          default: "./dist/default.js",
        },
      },
      files: {
        "dist/node-addons.js": "export const selected = 'node-addons'\n",
        "dist/node.js": "export const selected = 'node'\n",
        "dist/import.js": "export const selected = 'import'\n",
        "dist/default.js": "export const selected = 'default'\n",
      },
      suffix: "/dist/node-addons.js",
      selected: "node-addons",
    },
    {
      name: "resolves the bun export condition when it is first",
      folder: "bun-provider",
      exports: { ".": { bun: "./dist/bun.js", node: "./dist/node.js", import: "./dist/import.js" } },
      files: {
        "dist/bun.js": "export const selected = 'bun'\n",
        "dist/node.js": "export const selected = 'node'\n",
        "dist/import.js": "export const selected = 'import'\n",
      },
      suffix: "/dist/bun.js",
      selected: "bun",
    },
    {
      name: "does not use Node-only module-sync exports under Bun",
      folder: "module-sync-provider",
      exports: { ".": { "module-sync": "./dist/module-sync.js", import: "./dist/import.js", default: "./dist/default.js" } },
      files: {
        "dist/module-sync.js": "export const selected = 'module-sync'\n",
        "dist/import.js": "export const selected = 'import'\n",
        "dist/default.js": "export const selected = 'default'\n",
      },
      suffix: "/dist/import.js",
      selected: "import",
    },
    {
      name: "skips unsupported custom export conditions",
      folder: "custom-condition-provider",
      exports: {
        ".": {
          electron: "./dist/electron.js",
          development: "./dist/development.js",
          default: "./dist/default.js",
        },
      },
      files: {
        "dist/electron.js": "export const selected = 'electron'\n",
        "dist/development.js": "export const selected = 'development'\n",
        "dist/default.js": "export const selected = 'default'\n",
      },
      suffix: "/dist/default.js",
      selected: "default",
    },
  ]

  conditionalExportFixtures.forEach((fixture) => {
    test(fixture.name, async () => {
      await using tmp = await tmpdir()
      const dir = path.join(tmp.path, fixture.folder)
      await writePackageFixture(
        dir,
        {
          name: fixture.folder,
          type: "module",
          exports: fixture.exports,
        },
        fixture.files,
      )

      const entrypoint = expectEntryPoint(NpmEntrypoint.resolveManual(fixture.folder, dir))
      expect(entrypoint).toEndWith(fixture.suffix)
      expect((await import(entrypoint)).selected).toBe(fixture.selected)
    })
  })

  test.each([
    "./../outside.js",
    "./dist/../../outside.js",
    "dist/index.js",
    "/dist/index.js",
    "file:///tmp/index.js",
    "./",
    "././index.js",
    "./dist/../index.js",
    "./node_modules/pkg/index.js",
    "./%2e%2e/outside.js",
    "./%6eode_modules/outside.js",
    "./dist%2findex.js",
    "./dist%5cindex.js",
    "./dist/%zz/index.js",
  ])(
    "does not resolve invalid export target: %s",
    async (target) => {
      await using tmp = await tmpdir()
      await writePackageFixture(
        path.join(tmp.path, "invalid-provider"),
        {
          name: "invalid-provider",
          type: "module",
          exports: target,
        },
        {},
      )
      await Bun.write(path.join(tmp.path, "outside.js"), "export const leaked = true\n")

      const entry = NpmEntrypoint.resolveManual("invalid-provider", path.join(tmp.path, "invalid-provider"))

      expect(Option.isNone(entry.entrypoint)).toBe(true)
    },
  )

  test("does not resolve subpath-only export objects as package entrypoints", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "subpath-provider"),
      {
        name: "subpath-provider",
        type: "module",
        exports: {
          "./feature": "./dist/feature.js",
        },
      },
      {
        "dist/feature.js": "export const feature = true\n",
      },
    )

    const entry = NpmEntrypoint.resolveManual("subpath-provider", path.join(tmp.path, "subpath-provider"))

    expect(Option.isNone(entry.entrypoint)).toBe(true)
  })

  test("does not resolve mixed subpath and condition export objects", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "mixed-provider"),
      {
        name: "mixed-provider",
        type: "module",
        exports: {
          ".": "./dist/index.js",
          default: "./dist/default.js",
        },
      },
      {
        "dist/index.js": "export const mixed = true\n",
        "dist/default.js": "export const mixed = true\n",
      },
    )

    const entry = NpmEntrypoint.resolveManual("mixed-provider", path.join(tmp.path, "mixed-provider"))

    expect(Option.isNone(entry.entrypoint)).toBe(true)
  })

  test("normalizes raw backslashes in export targets", async () => {
    await using tmp = await tmpdir()
    await writePackageFixture(
      path.join(tmp.path, "backslash-provider"),
      {
        name: "backslash-provider",
        type: "module",
        exports: "./dist\\index.js",
      },
      {
        "dist/index.js": "export const selected = 'backslash'\n",
      },
    )

    const entrypoint = expectEntryPoint(
      NpmEntrypoint.resolveManual("backslash-provider", path.join(tmp.path, "backslash-provider")),
    )
    expect(entrypoint).toEndWith("/dist/index.js")
    expect((await import(entrypoint)).selected).toBe("backslash")
  })

  test("resolves ESM exports from awkward nested file paths", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(
      tmp.path,
      "path with spaces [one] & percent %25",
      "nested folder (two)",
      "very-long-segment-name-for-entrypoint-resolution",
      "fixture-provider",
    )
    await writePackageFixture(
      dir,
      {
        name: "fixture-provider-long-path",
        type: "module",
        exports: "./dist/index.js",
      },
      {
        "dist/index.js": "export const createLongPathFixture = () => ({ languageModel: () => undefined })\n",
      },
    )

    const entry = NpmEntrypoint.resolveManual("fixture-provider-long-path", dir)

    const entrypoint = expectEntryPoint(entry)
    expect(entrypoint).toEndWith("/dist/index.js")
    await expect(import(entrypoint)).resolves.toHaveProperty("createLongPathFixture")
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
