import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Environment } from "@opencode-ai/core/environment/index"
import { Workspace } from "@opencode-ai/core/workspace"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const options = {
  app: { version: "test-version" },
  database: { path: ":memory:" },
  fs: { filewatcher: false },
} as const

const request = (directory: string, workspace?: string) => {
  const url = new URL("http://opencode.local/api/location")
  url.searchParams.set("location[directory]", directory)
  if (workspace) url.searchParams.set("location[workspace]", workspace)
  return new Request(url)
}

it.live("distinguishes absent directories, files, and location initialization failures", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir("location-errors-")),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const handler = yield* ServerFetch.make({ ...options, config: { directory: tmp.path } })
    const missing = path.join(tmp.path, "missing")
    const absent = yield* Effect.promise(() => handler(request(missing)))
    expect(absent.status).toBe(404)
    expect(yield* Effect.promise(() => absent.json())).toMatchObject({
      _tag: "LocationDirectoryError",
      directory: missing,
      reason: "not_found",
    })

    yield* Effect.promise(() => fs.mkdir(missing))
    expect((yield* Effect.promise(() => handler(request(missing)))).status).toBe(200)
    const link = path.join(tmp.path, "link")
    yield* Effect.promise(() => fs.symlink(missing, link, "junction"))
    expect((yield* Effect.promise(() => handler(request(link)))).status).toBe(200)
    // Recheck the filesystem even when location services were previously cached.
    yield* Effect.promise(() => fs.rm(missing, { recursive: true }))
    expect((yield* Effect.promise(() => handler(request(missing)))).status).toBe(404)
    expect((yield* Effect.promise(() => handler(request(link)))).status).toBe(404)

    const file = path.join(tmp.path, "file")
    yield* Effect.promise(() => fs.writeFile(file, "not a directory"))
    const wrongKind = yield* Effect.promise(() => handler(request(file)))
    expect(wrongKind.status).toBe(404)
    expect(yield* Effect.promise(() => wrongKind.json())).toMatchObject({
      _tag: "LocationDirectoryError",
      directory: file,
      reason: "not_directory",
    })

    const broken = yield* ServerFetch.make(
      { ...options, config: { directory: tmp.path } },
      {
        overrides: [
          [Config.node, Layer.effect(Config.Service, Effect.die(new Error("configuration initialization failed")))],
        ],
      },
    )
    const failed = yield* Effect.promise(() => broken(request(tmp.path)))
    expect(failed.status).toBe(500)
    const protectedHandler = yield* ServerFetch.make({ ...options, password: "test-password" })
    expect((yield* Effect.promise(() => protectedHandler(request(missing)))).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("checks workspace directories in their own filesystem and does not misclassify access failures", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir("location-workspace-")),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const memory = Environment.makeMemoryDriver()
    const files = Environment.makeFiles(memory)
    const directory = path.join(tmp.path, "workspace-only")
    yield* files.mkdir(directory)
    let denied = false
    const workspace = Workspace.Service.of({
      create: () => Effect.die("unused"),
      provision: () => Effect.die("unused"),
      destroy: () => Effect.die("unused"),
      connect: () =>
        Effect.succeed({
          ...memory,
          overrides: {
            ...memory.overrides,
            stat: (value: string) =>
              denied
                ? Effect.fail(new Environment.Failed({ path: value, cause: new Error("permission denied") }))
                : files.stat(value),
          },
        }),
    })
    const handler = yield* ServerFetch.make(options, {
      overrides: [[Workspace.node, Layer.succeed(Workspace.Service, workspace)]],
    })
    const id = Workspace.ID.create()
    const loaded = yield* Effect.promise(() => handler(request(directory, id)))
    expect(loaded.status).toBe(200)
    denied = true
    expect((yield* Effect.promise(() => handler(request(directory, id)))).status).toBe(500)
    denied = false
    yield* files.remove(directory)
    const missing = yield* Effect.promise(() => handler(request(directory, id)))
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.json())).toMatchObject({
      _tag: "LocationDirectoryError",
      reason: "not_found",
    })
  }).pipe(Effect.scoped),
)
