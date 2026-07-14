#!/usr/bin/env bun

import { Service } from "@opencode-ai/client/effect"
import { ServiceStatus } from "@opencode-ai/protocol/groups/health"
import { Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const target = `cli-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
const directory = path.join(import.meta.dir, "..", "dist", target, "bin")
const binary = path.join(directory, `opencode2${process.platform === "win32" ? ".exe" : ""}`)
if (!(await Bun.file(binary).exists())) throw new Error(`Missing compiled CLI in ${directory}`)

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-smoke-"))
const env = {
  ...process.env,
  HOME: root,
  USERPROFILE: root,
  OPENCODE_DB: path.join(root, "opencode.db"),
  OPENCODE_TEST_HOME: root,
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
}
const processes: Array<ReturnType<typeof Bun.spawn>> = []
const errors: Array<Promise<string>> = []
let failure: unknown
try {
  spawnService()
  spawnService()
  const registration = await waitForRegistration()
  const info = await Schema.decodeUnknownPromise(Service.Info)(await Bun.file(registration).json())
  if (info.id === undefined || info.password === undefined) throw new Error("Registration is missing service identity")
  const credential = btoa(`opencode:${info.password}`)
  const headers = { authorization: "Basic " + credential }
  const token = encodeURIComponent(credential)
  const health = await waitForReady(info.url, headers)
  if (health.pid !== info.pid || health.instanceID !== info.id)
    throw new Error("Health identity does not match registration")
  const tokenHealth = await fetch(
    new URL(`/api/health?auth_token=${token}`, info.url),
    { signal: AbortSignal.timeout(5_000) },
  )
  if (tokenHealth.status !== 200) throw new Error("Compiled service rejected query authentication")
  const tokenOpenApi = await fetch(
    new URL(`/openapi.json?auth_token=${token}`, info.url),
    { signal: AbortSignal.timeout(5_000) },
  )
  if (tokenOpenApi.status !== 200) throw new Error("Compiled application rejected query authentication")

  const unauthorizedHealth = await fetch(new URL("/api/health", info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorizedHealth.status !== 401) throw new Error("Compiled service exposed health without authentication")
  const unauthorizedOpenApi = await fetch(new URL("/openapi.json", info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorizedOpenApi.status !== 401) throw new Error("Compiled service exposed application routes without authentication")
  const unauthorizedStop = await fetch(new URL("/api/service/stop", info.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceID: info.id }),
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorizedStop.status !== 401) throw new Error("Compiled service accepted unauthenticated stop")

  const winner = processes.find((process) => process.pid === info.pid)
  const loser = processes.find((process) => process.pid !== info.pid)
  if (!winner || !loser) throw new Error("Compiled contenders did not elect one registered owner")
  if (!(await exitsWithin(loser, 10_000))) throw new Error("Losing compiled contender did not exit")

  const stopped = await Schema.decodeUnknownPromise(ServiceStatus.StopResponse)(
    await fetch(new URL("/api/service/stop", info.url), {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ instanceID: info.id, targetVersion: "smoke-next" }),
      signal: AbortSignal.timeout(5_000),
    }).then((response) => response.json()),
  )
  if (!stopped.accepted) throw new Error("Compiled service rejected exact-instance stop")
  if (!(await exitsWithin(winner, 10_000))) throw new Error("Compiled service did not stop")
  for (let attempt = 0; attempt < 200 && (await Bun.file(registration).exists()); attempt++) await Bun.sleep(25)
  if (await Bun.file(registration).exists()) throw new Error("Compiled service registration was not removed")
} catch (cause) {
  failure = cause
} finally {
  processes.forEach((process) => process.kill())
  await Promise.all(processes.map((process) => process.exited))
}

const output = await Promise.all(errors)
await fs.rm(root, { recursive: true, force: true })
if (failure)
  throw new Error(output.filter(Boolean).join("\n") || "Compiled service lifecycle smoke test failed", {
    cause: failure,
  })

function spawnService() {
  const process = Bun.spawn([binary, "serve", "--service"], { env, stdout: "ignore", stderr: "pipe" })
  processes.push(process)
  errors.push(new Response(process.stderr).text())
  return process
}

async function waitForRegistration() {
  const directory = path.join(root, "state", "opencode")
  for (let attempt = 0; attempt < 400; attempt++) {
    const files = await fs.readdir(directory).catch(() => [])
    const file = files.find(
      (file) => file === "service.json" || (file.startsWith("service-") && file.endsWith(".json")),
    )
    if (file) return path.join(directory, file)
    await Bun.sleep(25)
  }
  throw new Error("Compiled service did not publish registration")
}

async function waitForReady(url: string, headers: HeadersInit) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const health = await fetch(new URL("/api/health", url), {
      headers,
      signal: AbortSignal.timeout(1_000),
    })
      .then((response) => response.json())
      .then(Schema.decodeUnknownPromise(ServiceStatus.Health))
      .catch(() => undefined)
    if (health === undefined) {
      await Bun.sleep(25)
      continue
    }
    if (health.status.type === "ready") return health
    if (health.status.type === "failed") throw new Error(health.status.message)
    await Bun.sleep(25)
  }
  throw new Error("Compiled service did not become ready")
}

function exitsWithin(process: Bun.Subprocess, milliseconds: number) {
  return Promise.race([process.exited.then(() => true), Bun.sleep(milliseconds).then(() => false)])
}
