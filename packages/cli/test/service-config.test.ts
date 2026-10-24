import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, test } from "bun:test"
import { Effect, Exit, FileSystem } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"

/**
 * Runs `body` against a config directory holding `contents` (no file at all when undefined), with
 * the service config bound to it, and hands back the file's path so a test can assert on what was
 * left on disk.
 */
async function withConfig(contents: string | undefined, body: (input: { file: string; run: Run }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-config-"))
  const config = path.join(root, "config")
  const state = path.join(root, "state")
  const file = path.join(config, ServiceConfig.filename())
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(state, { recursive: true })
  if (contents !== undefined) await fs.writeFile(file, contents)
  const run: Run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(Global.Service, Global.make({ config, state })),
        Effect.provide(NodeServices.layer),
      ),
    )
  try {
    await body({ file, run })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

type Run = <A, E>(effect: Effect.Effect<A, E, Global.Service | FileSystem.FileSystem>) => Promise<A>

test("a config that exists but cannot be decoded is reported, not read as empty", async () => {
  await withConfig("{ not json", async ({ file, run }) => {
    expect(Exit.isFailure(await run(ServiceConfig.read().pipe(Effect.exit)))).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe("{ not json")
  })
})

test("set leaves the stored settings alone when the config cannot be decoded", async () => {
  // A torn write from two `service set` runs sharing one temp path leaves exactly this shape.
  const torn = '{"hostname":"127.0.0.1","password":"user-secr'
  await withConfig(torn, async ({ file, run }) => {
    expect(Exit.isFailure(await run(ServiceConfig.set("env", "TOKEN", "value").pipe(Effect.exit)))).toBe(true)
    expect(await fs.readFile(file, "utf8")).toBe(torn)
  })
})

test("a missing config still reads as empty so the first set succeeds", async () => {
  await withConfig(undefined, async ({ file, run }) => {
    expect(await run(ServiceConfig.read())).toEqual({})
    await run(ServiceConfig.set("port", "4321"))
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ port: 4321 })
  })
})
