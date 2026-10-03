import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { which } from "@opencode-ai/core/util/which"
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
  test.each(["fixture-provider", "@fixture/provider"])(
    "shares and refreshes bare/latest installs of %s",
    async (name) => {
      await using tmp = await tmpdir()
      const manifests = ["1.0.0", "1.1.0"].map((version) => ({ name, version, main: "index.js" }))
      const archives = await Promise.all(
        manifests.map((manifest) =>
          new Bun.Archive(
            {
              "package/package.json": JSON.stringify(manifest),
              "package/index.js": `export default ${JSON.stringify(manifest.version)}\n`,
            },
            { compress: "gzip" },
          ).bytes(),
        ),
      )
      let latest = 0
      let downloads = 0
      const server = Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url)
          const archive = manifests.findIndex((manifest) => url.pathname === `/${manifest.version}.tgz`)
          if (archive !== -1) {
            downloads++
            return new Response(archives[archive])
          }
          if (decodeURIComponent(url.pathname) !== `/${name}`) return new Response("not found", { status: 404 })
          return Response.json({
            name,
            "dist-tags": { latest: manifests[latest].version },
            versions: Object.fromEntries(
              manifests.map((manifest) => [
                manifest.version,
                { ...manifest, dist: { tarball: new URL(`/${manifest.version}.tgz`, url).href } },
              ]),
            ),
          })
        },
      })
      const cache = path.join(tmp.path, "cache")
      const dir = path.join(cache, "packages", `${name}@latest`)
      await Promise.all(
        [dir, path.join(cache, "packages", name)].map((directory) =>
          Bun.write(path.join(directory, ".npmrc"), `registry=${server.url.href}\ncache=${tmp.path}/npm\n`),
        ),
      )

      try {
        const first = await Effect.gen(function* () {
          const npm = yield* Npm.Service
          return yield* Effect.all([npm.add(name), npm.add(`${name}@latest`)], { concurrency: "unbounded" })
        }).pipe(Effect.provide(npmLayer(cache)), Effect.runPromise)
        expect(first[0]).toEqual(first[1])
        expect(first[0].directory).toBe(path.join(dir, "node_modules", name))
        expect(await Bun.file(path.join(first[0].directory, "package.json")).json()).toMatchObject({ version: "1.0.0" })
        expect(downloads).toBe(1)

        latest = 1
        const second = await Effect.gen(function* () {
          const npm = yield* Npm.Service
          return yield* npm.add(name)
        }).pipe(Effect.provide(npmLayer(cache)), Effect.runPromise)
        expect(second.directory).toBe(first[0].directory)
        expect(await Bun.file(path.join(second.directory, "package.json")).json()).toMatchObject({ version: "1.1.0" })
        expect(downloads).toBe(2)

        await Bun.write(
          path.join(dir, ".npmrc"),
          `registry=${server.url.href}\ncache=${tmp.path}/offline\noffline=true\n`,
        )
        const offline = await Effect.gen(function* () {
          const npm = yield* Npm.Service
          return yield* npm.add(name)
        }).pipe(Effect.provide(npmLayer(cache)), Effect.runPromise)
        expect(offline).toEqual(second)
        expect(await Bun.file(path.join(offline.directory, "package.json")).json()).toMatchObject({ version: "1.1.0" })
        expect(downloads).toBe(2)
      } finally {
        await server.stop(true)
      }
    },
  )

  test("reuses an installed exact version without contacting the registry", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "cache", "packages", "fixture-provider@1.0.0")
    const installed = path.join(dir, "node_modules", "fixture-provider")
    await writePackage(installed, { name: "fixture-provider", main: "index.js" })
    await Bun.write(path.join(installed, "index.js"), "export default true\n")
    await Bun.write(path.join(dir, ".npmrc"), `offline=true\ncache=${tmp.path}/npm\n`)

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add("fixture-provider@1.0.0")
    }).pipe(Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)
    expect(entry.directory).toBe(installed)
    expect(entry.entrypoint).toBeDefined()
  })

  test("keeps a legacy bare-name cache usable offline", async () => {
    await using tmp = await tmpdir()
    const cache = path.join(tmp.path, "cache")
    const installed = path.join(cache, "packages", "fixture-provider", "node_modules", "fixture-provider")
    await writePackage(installed, { name: "fixture-provider", main: "index.js" })
    await Bun.write(path.join(installed, "index.js"), "export default true\n")
    await Bun.write(
      path.join(cache, "packages", "fixture-provider@latest", ".npmrc"),
      `offline=true\ncache=${tmp.path}/npm\n`,
    )

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add("fixture-provider")
    }).pipe(Effect.provide(npmLayer(cache)), Effect.runPromise)
    expect(entry.directory).toBe(installed)
    expect(entry.entrypoint).toBeDefined()
  })

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

  // The Desktop sidecar runs the server under Node, where import.meta.resolve cannot take a
  // parent URL. Exercise the real Node branch instead of the Bun one the test runner uses.
  test("resolves an importable file URL under Node", async () => {
    await using tmp = await tmpdir()
    const node = which("node")
    if (!node) throw new Error("Node is required for the Npm Node runtime test")

    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "../src/npm.ts")],
      target: "node",
      format: "esm",
    })
    expect(bundle.success).toBe(true)
    const entry = path.join(tmp.path, "npm.mjs")
    await Bun.write(entry, bundle.outputs[0])

    const dual = path.join(tmp.path, "dual-provider")
    await writePackage(dual, {
      name: "dual-provider",
      exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.js" } },
    })
    await Bun.write(path.join(dual, "dist", "index.mjs"), "export const createDual = () => 'esm'\n")
    await Bun.write(path.join(dual, "dist", "index.js"), "exports.createDual = () => 'cjs'\n")

    const scoped = path.join(tmp.path, "scoped-provider")
    await writePackage(scoped, {
      name: "@fixture/scoped-provider",
      type: "module",
      exports: "./dist/index.js",
    })
    await Bun.write(path.join(scoped, "dist", "index.js"), "export const createScoped = () => 'scoped'\n")

    const proc = Bun.spawn(
      [
        node,
        "--input-type=module",
        "-e",
        `
        import assert from "node:assert/strict"
        import { Npm } from ${JSON.stringify(pathToFileURL(entry).href)}
        assert.equal(typeof Bun, "undefined")
        for (const [spec, name] of [
          [${JSON.stringify(`dual-provider@file:${dual}`)}, "createDual"],
          [${JSON.stringify(`@fixture/scoped-provider@file:${scoped}`)}, "createScoped"],
        ]) {
          const result = await Npm.add(spec)
          assert.ok(result.entrypoint?.startsWith("file://"), "entrypoint is a file URL: " + result.entrypoint)
          const mod = await import(result.entrypoint)
          assert.equal(typeof mod[name], "function", "module exports " + name)
        }
        process.exit(0)
      `,
      ],
      {
        env: { ...process.env, XDG_CACHE_HOME: path.join(tmp.path, "cache") },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(stderr, stdout).toBe("")
    expect(code).toBe(0)
  }, 30_000)
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
