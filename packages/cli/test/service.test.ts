import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode-ai/client/effect"
import { Global } from "@opencode-ai/core/global"
import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"

test("local channel stores service config with the local service filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-"))
  try {
    await Effect.runPromise(
      ServiceConfig.set("hostname", "127.0.0.2").pipe(
        Effect.provide(Global.layerWith({ config: path.join(root, "config"), state: path.join(root, "state") })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    expect(await Bun.file(path.join(root, "config", "service-local.json")).json()).toEqual({
      hostname: "127.0.0.2",
    })
    expect(await Bun.file(path.join(root, "config", "service.json")).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("concurrent service processes elect one server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-election-"))
  const env = {
    ...process.env,
    HOME: root,
    OPENCODE_DB: path.join(root, "opencode.db"),
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
  const command = [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"]
  const first = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })
  const second = Bun.spawn(command, { env, stderr: "pipe", stdout: "ignore" })

  try {
    const registration = path.join(root, "state", "opencode", "service-local.json")
    const info = await waitForInfo(registration)
    const winner = info.pid === first.pid ? first : second
    const loser = info.pid === first.pid ? second : first
    const exited = await Promise.race([loser.exited.then(() => true), Bun.sleep(10_000).then(() => false)])

    expect(exited).toBe(true)
    expect(winner.exitCode).toBe(null)
  } finally {
    first.kill("SIGTERM")
    second.kill("SIGTERM")
    await Promise.all([first.exited, second.exited])
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function waitForInfo(file: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) return Schema.decodeUnknownPromise(Service.Info)(value)
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}
