#!/usr/bin/env bun

import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { ServerInfo } from "@opencode/protocol/groups/server"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const nodeBuild = process.argv.includes("--node")
const target = `cli${nodeBuild ? "-node" : ""}-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
const directory = path.join(import.meta.dir, "..", "dist", ...(nodeBuild ? ["node"] : []), target, "bin")
const binary = path.join(
  directory,
  `${nodeBuild ? "opencode2-node" : "opencode"}${process.platform === "win32" ? ".exe" : ""}`,
)
if (!(await Bun.file(binary).exists())) throw new Error(`Missing compiled CLI in ${directory}`)

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-smoke-")))
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
  await fs.mkdir(path.join(root, ".opencode", "plugins"), { recursive: true })
  spawnService()
  spawnService()
  const registration = await waitForRegistration()
  const info = await Schema.decodeUnknownPromise(Service.Info)(await Bun.file(registration).json())
  if (info.id === undefined || info.password === undefined) throw new Error("Registration is missing service identity")
  const credential = btoa(`opencode:${info.password}`)
  const headers = { authorization: "Basic " + credential }
  const token = encodeURIComponent(credential)
  const serverInfo = await waitForReady(info.url, headers)
  if (serverInfo.pid !== info.pid) throw new Error("Server info does not match registration")
  const tokenInfo = await fetch(new URL(`/api/info?auth_token=${token}`, info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (tokenInfo.status !== 200) throw new Error("Compiled service rejected query authentication")
  const tokenOpenApi = await fetch(new URL(`/openapi.json?auth_token=${token}`, info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (tokenOpenApi.status !== 200) throw new Error("Compiled application rejected query authentication")
  if ((await pluginIDs(info.url, headers)).includes("smoke")) throw new Error("Smoke plugin existed before creation")
  const plugin = path.join(root, ".opencode", "plugins", "smoke.ts")
  await fs.writeFile(plugin, pluginSource())
  await waitForPlugin(info.url, headers, plugin)

  const unauthorizedInfo = await fetch(new URL("/api/info", info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorizedInfo.status !== 401) throw new Error("Compiled service exposed info without authentication")
  const unauthorizedOpenApi = await fetch(new URL("/openapi.json", info.url), {
    signal: AbortSignal.timeout(5_000),
  })
  if (unauthorizedOpenApi.status !== 401)
    throw new Error("Compiled service exposed application routes without authentication")
  const stopRoute = await fetch(new URL("/api/service/stop", info.url), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ instanceID: info.id }),
    signal: AbortSignal.timeout(5_000),
  })
  if (stopRoute.status !== 404) throw new Error("Compiled service exposed the removed HTTP stop route")

  const winner = processes.find((process) => process.pid === info.pid)
  const loser = processes.find((process) => process.pid !== info.pid)
  if (!winner || !loser) throw new Error("Compiled contenders did not elect one registered owner")
  if (!(await exitsWithin(loser, 10_000))) throw new Error("Losing compiled contender did not exit")

  await Effect.runPromise(
    Service.stop({ file: registration }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
  if (!(await exitsWithin(winner, 10_000))) throw new Error("Compiled service did not stop")
  for (let attempt = 0; attempt < 200 && (await Bun.file(registration).exists()); attempt++) await Bun.sleep(25)
  if (await Bun.file(registration).exists()) throw new Error("Compiled service registration was not removed")
} catch (cause) {
  failure = cause
} finally {
  processes.forEach((process) => process.kill())
  await Promise.all(processes.map((process) => process.exited))
  if (failure)
    errors.push(fs.readFile(path.join(root, "data", "opencode", "log", "opencode.log"), "utf8").catch(() => ""))
}

const output = await Promise.all(errors)
// Windows can retain directory handles briefly after the service processes exit.
await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch((cause: unknown) => {
  console.error("Failed to remove service smoke-test directory", cause)
  failure ??= cause
})
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
    const response = await fetch(new URL("/api/info", url), {
      headers,
      signal: AbortSignal.timeout(1_000),
    }).catch(() => undefined)
    if (response?.ok) return Schema.decodeUnknownPromise(ServerInfo)(await response.json())
    await Bun.sleep(25)
  }
  throw new Error("Compiled service did not become ready")
}

function exitsWithin(process: Bun.Subprocess, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds)
    process.exited.then(() => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
}

function pluginSource() {
  return 'export default { id: "smoke", setup: async () => {} }\n'
}

async function pluginIDs(url: string, headers: HeadersInit) {
  const endpoint = new URL("/api/plugin", url)
  endpoint.searchParams.set("location[directory]", root)
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5_000) })
  const body: unknown = await response.json()
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
    throw new Error("Compiled service returned an invalid plugin list")
  }
  return body.data.flatMap((plugin) =>
    typeof plugin === "object" && plugin !== null && "id" in plugin && typeof plugin.id === "string" ? [plugin.id] : [],
  )
}

async function waitForPlugin(url: string, headers: HeadersInit, plugin: string) {
  const deadline = Date.now() + 10_000
  let attempt = 0
  while (Date.now() < deadline) {
    if ((await pluginIDs(url, headers)).includes("smoke")) return
    await Bun.sleep(25)
    // Native watchers may coalesce a single creation edge. Keep changing valid source so
    // the smoke proves that a later native event is delivered.
    if (++attempt % 10 === 0) await fs.writeFile(plugin, `${pluginSource()}// watcher retry ${attempt}\n`)
  }
  throw new Error("Compiled service did not discover the created plugin")
}
