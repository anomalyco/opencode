import fs from "fs/promises"
import path from "path"
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
})
