import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { tmpdir } from "./fixture/fixture"

const win = process.platform === "win32"

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

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

describe("Npm.add cache fast-path", () => {
  function cacheLayer(cacheDir: string) {
    const tmp = os.tmpdir()
    return LayerNode.compile(Npm.node, [
      [
        Global.node,
        Layer.succeed(
          Global.Service,
          Global.Service.of({
            home: tmp,
            data: tmp,
            cache: cacheDir,
            config: tmp,
            state: tmp,
            repos: tmp,
            bin: tmp,
            log: tmp,
            tmp,
          }),
        ),
      ],
    ])
  }

  async function seedCache(cacheDir: string, pkg: string, installedName: string) {
    const installRoot = path.join(cacheDir, "packages", Npm.sanitize(pkg))
    const pkgDir = path.join(installRoot, "node_modules", installedName)
    await fs.mkdir(pkgDir, { recursive: true })
    await Bun.write(
      path.join(installRoot, "package.json"),
      JSON.stringify({ dependencies: { [installedName]: pkg } }),
    )
    await Bun.write(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: installedName, version: "1.0.0", main: "index.js" }),
    )
    await Bun.write(path.join(pkgDir, "index.js"), "module.exports = {}")
    return { installRoot, pkgDir }
  }

  test("resolves remote tarball URL to actual installed package directory", async () => {
    await using tmp = await tmpdir()
    const url =
      "https://github.com/sjawhar/opencode-anthropic-auth/releases/download/v0.4.2/sjawhar-opencode-anthropic-auth-0.4.2.tgz"
    const installed = "@sjawhar/opencode-anthropic-auth"
    const { pkgDir } = await seedCache(tmp.path, url, installed)

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.add(url)).pipe(Effect.provide(cacheLayer(tmp.path))),
    )

    expect(result.directory).toBe(pkgDir)
  })

  test("resolves git+https spec to actual installed package directory", async () => {
    await using tmp = await tmpdir()
    const spec = "git+https://github.com/example/some-repo.git"
    const installed = "@example/some-repo"
    const { pkgDir } = await seedCache(tmp.path, spec, installed)

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.add(spec)).pipe(Effect.provide(cacheLayer(tmp.path))),
    )

    expect(result.directory).toBe(pkgDir)
  })

  test("resolves github: shorthand to actual installed package directory", async () => {
    await using tmp = await tmpdir()
    const spec = "github:example/another-repo"
    const installed = "another-repo"
    const { pkgDir } = await seedCache(tmp.path, spec, installed)

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.add(spec)).pipe(Effect.provide(cacheLayer(tmp.path))),
    )

    expect(result.directory).toBe(pkgDir)
  })

  test("resolves local tarball file: spec to actual installed package directory", async () => {
    await using tmp = await tmpdir()
    const spec = "file:/some/local/path/example-1.0.0.tgz"
    const installed = "@example/local-pkg"
    const { pkgDir } = await seedCache(tmp.path, spec, installed)

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.add(spec)).pipe(Effect.provide(cacheLayer(tmp.path))),
    )

    expect(result.directory).toBe(pkgDir)
  })

  test("still resolves registry packages correctly", async () => {
    await using tmp = await tmpdir()
    const spec = "prettier"
    const { pkgDir } = await seedCache(tmp.path, spec, spec)

    const result = await Effect.runPromise(
      Npm.Service.use((svc) => svc.add(spec)).pipe(Effect.provide(cacheLayer(tmp.path))),
    )

    expect(result.directory).toBe(pkgDir)
  })
})
