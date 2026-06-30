import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Daemon } from "../src/services/daemon"

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-daemon-"))
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const daemon = yield* Daemon.Service
        yield* daemon.set("autostart", "false")
      }).pipe(
        Effect.provide(Daemon.layer),
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      autostart: false,
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
