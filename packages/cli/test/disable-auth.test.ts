import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { OPENCODE_VERSION } from "../src/version"
import { Env } from "../src/env"
import { expect, test } from "bun:test"
import { ConfigProvider, Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ServiceConfig } from "../src/services/service-config"
import { ServiceRegistration } from "../src/services/service-registration"
import { isolatedEnv } from "./fixture/environment"

const withEnv = (env: Record<string, string>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))

test("disableAuth reads OPENCODE_DISABLE_AUTH as truthy", async () => {
  expect(await Effect.runPromise(Env.disableAuth.pipe(withEnv({ OPENCODE_DISABLE_AUTH: "1" })))).toBe(true)
  expect(await Effect.runPromise(Env.disableAuth.pipe(withEnv({ OPENCODE_DISABLE_AUTH: "true" })))).toBe(true)
  expect(await Effect.runPromise(Env.disableAuth.pipe(withEnv({ OPENCODE_DISABLE_AUTH: "0" })))).toBe(false)
  expect(await Effect.runPromise(Env.disableAuth.pipe(withEnv({})))).toBe(false)
})

test("service registration omits the password field when authentication is disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-disable-auth-register-"))
  const registration = path.join(root, "service.json")
  try {
    const cleanup = await Effect.runPromise(
      ServiceRegistration.register({
        address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 4321 },
        id: "owner",
        file: registration,
        shutdown: Effect.never,
      }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
    )
    const info = await Bun.file(registration).json()
    expect(info).not.toHaveProperty("password")
    expect(info).toEqual({
      id: "owner",
      version: OPENCODE_VERSION,
      url: "http://127.0.0.1:4321",
      pid: process.pid,
    })
    await Effect.runPromise(cleanup.pipe(Effect.provide(NodeFileSystem.layer)))
    expect(await Bun.file(registration).exists()).toBe(false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("OPENCODE_DISABLE_AUTH=1 runs the managed service without a password", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-disable-auth-"))
  const port = await availablePort()
  const config = path.join(root, "config", ServiceConfig.filename())
  const registration = path.join(root, "state", "opencode", ServiceConfig.filename())
  await fs.mkdir(path.dirname(config), { recursive: true })
  await fs.writeFile(config, JSON.stringify({ port }))
  const owner = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), "serve", "--service"], {
    env: isolatedEnv(root, { OPENCODE_DISABLE_AUTH: "1" }),
    stderr: "pipe",
    stdout: "ignore",
  })
  try {
    const info = await waitForInfo(registration)
    expect(info.password).toBeUndefined()
    expect(await Bun.file(config).json()).toEqual({ port })

    const url = new URL("/api/info", info.url)
    await waitForStatus(url, 200)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(response.headers.get("www-authenticate")).toBeNull()
  } finally {
    owner.kill("SIGTERM")
    await owner.exited
    await fs.rm(root, { recursive: true, force: true })
  }
}, 30_000)

async function waitForInfo(file: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (value !== undefined) return await Schema.decodeUnknownPromise(Service.Info)(value)
    await Bun.sleep(50)
  }
  throw new Error("Timed out waiting for service registration")
}

async function waitForStatus(url: URL, status: number) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const code = await fetch(url)
      .then((response) => response.status)
      .catch(() => undefined)
    if (code === status) return
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for status ${status}`)
}

async function availablePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) throw new Error("Server did not bind a port")
  return port
}
