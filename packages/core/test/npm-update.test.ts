import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { tmpdir } from "./fixture/tmpdir"

const npmLayer = (cache: string) =>
  AppNodeBuilder.build(Npm.node, [[Global.node, Global.layerWith({ cache, state: path.join(cache, "state") })]])

describe("Npm plugin updates", () => {
  test("checks a moving Git ref without installing and explicitly updates its cached revision", async () => {
    await using tmp = await tmpdir()
    const repository = path.join(tmp.path, "plugin")
    const cache = path.join(tmp.path, "cache")
    await fs.mkdir(repository)
    await Bun.write(
      path.join(repository, "package.json"),
      JSON.stringify({ name: "fixture-plugin", version: "1.0.0", exports: "./index.js" }),
    )
    await Bun.write(path.join(repository, "index.js"), "export default 'first'\n")
    await Bun.$`git init -q -b main ${repository}`
    await commit(repository, "first")
    const first = await revision(repository)
    const spec = `git+file://${repository}#main`
    const layer = npmLayer(cache)

    const installed = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
    expect(installed.revision).toBe(first)

    await Bun.write(path.join(repository, "index.js"), "export default 'second'\n")
    await commit(repository, "second")
    const second = await revision(repository)

    const checked = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.check(spec)
    }).pipe(Effect.provide(layer), Effect.runPromise)
    expect(checked).toMatchObject({
      currentVersion: first,
      latestVersion: second,
      updateAvailable: true,
    })

    const updated = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.update(spec)
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
    expect(updated).toMatchObject({
      previousVersion: first,
      currentVersion: second,
      updated: true,
    })

    const current = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
    expect(current.directory).not.toBe(installed.directory)
    expect(current.revision).toBe(second)
    if (!current.entrypoint) throw new Error("Updated plugin entrypoint missing")
    expect(
      await Bun.file(
        current.entrypoint.startsWith("file:") ? fileURLToPath(current.entrypoint) : current.entrypoint,
      ).text(),
    ).toContain("second")
  })
})

async function commit(repository: string, message: string) {
  await Bun.$`git -C ${repository} add .`
  await Bun.$`git -C ${repository} -c user.name=fixture -c user.email=fixture@example.com commit -qm ${message}`
}

async function revision(repository: string) {
  return Bun.$`git -C ${repository} rev-parse HEAD`.text().then((value) => value.trim())
}
