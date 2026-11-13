#!/usr/bin/env bun

// Reproduces a background service that stops answering for a while, as one blocked on a saturated disk does,
// and shows whether a client reconnect waits for it or kills and replaces it.
//
//   bun script/service-stall.ts            freeze the service for 20 seconds, then let it carry on
//   bun script/service-stall.ts --stall 45 freeze it for 45 seconds
//   bun script/service-stall.ts --hang     never let it carry on: the reconnect must replace it
//
// The service runs from source in a throwaway HOME on its own port, so the live service is never touched.
// Suspending it (SIGSTOP, or NtSuspendProcess on Windows) freezes it the way a disk stall freezes its event loop:
// the port stays bound and accepts connections, but nothing answers. The reconnect is the `Service.ensure` call
// the TUI and CLI make when their event stream stalls. On Linux, a process truly blocked on disk IO is in state D
// instead, which SIGKILL cannot interrupt; SIGSTOP leaves it in state T, so this script exercises the silence
// window, not the disk check.

import { NodeFileSystem } from "@effect/platform-node"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"

const args = parseArgs({ options: { stall: { type: "string", default: "20" }, hang: { type: "boolean" } } }).values
const stall = Number(args.stall) * 1_000
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-service-stall-")))
const env = {
  HOME: root,
  USERPROFILE: root,
  OPENCODE_DB: path.join(root, "opencode.db"),
  OPENCODE_TEST_HOME: root,
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  BUN_RUNTIME_TRANSPILER_CACHE_PATH:
    process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ?? path.join(os.tmpdir(), "opencode-bun-cache"),
}
const command = [
  process.execPath,
  "run",
  path.join(import.meta.dir, "..", "src", "index.ts"),
  "serve",
  "--service",
  "--port",
  String(await freePort()),
]
const started = Date.now()
const log = (message: string) => console.log(`[${((Date.now() - started) / 1_000).toFixed(1).padStart(5)}s] ${message}`)

const owner = Bun.spawn(command, { env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" })
let resume: ReturnType<typeof setTimeout> | undefined
try {
  const file = await waitForRegistration()
  const original = await Bun.file(file).json()
  await waitForReady(file)
  log(`service ${original.pid} is ready at ${original.url}`)

  await suspend(original.pid, "freeze")
  log(`froze service ${original.pid}${args.hang ? " for good" : ` for ${stall / 1_000}s`}`)
  if (!args.hang)
    resume = setTimeout(() => {
      // A process the reconnect already killed is gone; there is nothing to resume.
      if (!alive(original.pid)) return
      void suspend(original.pid, "resume").then(() => log(`resumed service ${original.pid}`))
    }, stall)

  log("reconnecting, as a TUI does once its event stream stalls")
  const endpoint = await Effect.runPromise(
    Service.ensure({ file, env, command }).pipe(Effect.provide(NodeFileSystem.layer)),
  )
  const current = await Bun.file(file).json()
  log(`reconnected to ${endpoint.url}`)
  console.log(
    current.pid === original.pid
      ? `\nWAITED: the reconnect kept service ${original.pid}.`
      : `\nREPLACED: the reconnect killed service ${original.pid} and started ${current.pid}.`,
  )
} finally {
  clearTimeout(resume)
  const registered = await waitForRegistration(0).then(
    (file) => Bun.file(file).json(),
    () => undefined,
  )
  // SIGKILL (TerminateProcess on Windows) also ends a suspended process.
  if (registered !== undefined && alive(registered.pid)) process.kill(registered.pid, "SIGKILL")
  owner.kill("SIGKILL")
  await owner.exited
  // Windows can hold the killed services' files for a few seconds more.
  await fs
    .rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    .catch(() => console.warn(`Could not remove ${root}; delete it by hand.`))
}

// Windows has no SIGSTOP, so suspend and resume every thread of the process through ntdll instead.
async function suspend(pid: number, action: "freeze" | "resume") {
  if (process.platform !== "win32") return void process.kill(pid, action === "freeze" ? "SIGSTOP" : "SIGCONT")
  const call = action === "freeze" ? "NtSuspendProcess" : "NtResumeProcess"
  const child = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `$nt = Add-Type -Name Nt -Namespace Stall -PassThru -MemberDefinition '[DllImport("ntdll.dll")] public static extern int ${call}(IntPtr process);'; ` +
        `if ($nt::${call}((Get-Process -Id ${pid}).Handle) -ne 0) { exit 1 }`,
    ],
    { stdout: "ignore", stderr: "inherit" },
  )
  if ((await child.exited) !== 0) throw new Error(`Failed to ${action} process ${pid}`)
}

async function freePort() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  return port
}

async function waitForRegistration(timeout = 60_000) {
  const directory = path.join(root, "state", "opencode")
  const deadline = Date.now() + timeout
  do {
    const files = await fs.readdir(directory).catch(() => [])
    const file = files.find(
      (file) => file === "service.json" || (file.startsWith("service-") && file.endsWith(".json")),
    )
    if (file) return path.join(directory, file)
    await Bun.sleep(25)
  } while (Date.now() < deadline)
  throw new Error("The service did not publish its registration")
}

async function waitForReady(file: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if ((await Effect.runPromise(Service.discover({ file }).pipe(Effect.provide(NodeFileSystem.layer)))) !== undefined)
      return
    await Bun.sleep(100)
  }
  throw new Error("The service did not become ready")
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
