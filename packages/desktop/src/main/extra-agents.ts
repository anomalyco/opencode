import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createConnection, createServer } from "node:net"
import { app } from "electron"
import type {
  ExtraAgentId,
  ExtraAgentServer,
  GenericagentConfig,
  GenericagentTest,
  HermesConfig,
  HermesTest,
  OpenclawConfig,
  OpenclawTest,
} from "../preload/types"
import { write as writeLog } from "./logging"
import { bundledCliPath, getGenericagentConfig, getHermesConfig, getOpenclawConfig } from "./native"

type ConfigById = {
  openclaw: OpenclawConfig
  genericagent: GenericagentConfig
  hermes: HermesConfig
}

type TestById = {
  openclaw: OpenclawTest
  genericagent: GenericagentTest
  hermes: HermesTest
}

type Runtime = {
  id: ExtraAgentId
  url: string
  hash: string
  child: ChildProcessWithoutNullStreams
  exit: Promise<number | null>
  stop: () => Promise<void>
}

const HOSTNAME = "127.0.0.1"
const START_TIMEOUT_MS = 12_000
const HEALTH_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 4_000

const running = new Map<ExtraAgentId, Runtime>()
const activeTests = new Map<ExtraAgentId, { cancel: () => void }>()

export async function listExtraAgentServers(): Promise<ExtraAgentServer[]> {
  const output: ExtraAgentServer[] = []
  await Promise.all(
    (["openclaw", "hermes", "genericagent"] as const).map(async (id) => {
      const config = readConfig(id)
      if (!config.enabled) {
        await stopExtraAgent(id)
        return
      }
      try {
        const runtime = await ensureExtraAgent(id, config)
        output.push({ id, url: runtime.url })
      } catch (error) {
        writeLog("extra-agent", "failed to start bridge", { id, error: serializeError(error).message }, "error")
      }
    }),
  )
  return output.sort((a, b) => order(a.id) - order(b.id))
}

export async function reloadExtraAgents() {
  await Promise.all((["openclaw", "hermes", "genericagent"] as const).map((id) => stopExtraAgent(id)))
}

export async function testOpenclawBridge(config: OpenclawConfig): Promise<OpenclawTest> {
  return testExtraAgent("openclaw", config)
}

export async function testGenericagentBridge(config: GenericagentConfig): Promise<GenericagentTest> {
  return testExtraAgent("genericagent", config)
}

export async function testHermesBridge(config: HermesConfig): Promise<HermesTest> {
  return testExtraAgent("hermes", config)
}

export function abortExtraAgentTest(id: ExtraAgentId) {
  const test = activeTests.get(id)
  if (!test) return false
  test.cancel()
  activeTests.delete(id)
  return true
}

async function ensureExtraAgent<T extends ExtraAgentId>(id: T, config: ConfigById[T]) {
  const hash = configHash(id, config)
  const current = running.get(id)
  if (current?.hash === hash) return current
  if (current) await current.stop()
  const runtime = await startBridge(id, config, "runtime")
  running.set(id, runtime)
  return runtime
}

async function stopExtraAgent(id: ExtraAgentId) {
  const runtime = running.get(id)
  if (!runtime) return
  running.delete(id)
  await runtime.stop()
}

async function testExtraAgent<T extends ExtraAgentId>(id: T, config: ConfigById[T]): Promise<TestById[T]> {
  if (!config.enabled) return { ok: true, logs: [`${displayName(id)} integration is disabled.`] } as TestById[T]

  activeTests.get(id)?.cancel()

  const logs: string[] = []
  let runtime: Runtime | undefined
  let cancelled = false
  const cancel = () => {
    cancelled = true
    void runtime?.stop()
  }
  const activeTest = { cancel }
  activeTests.set(id, activeTest)

  try {
    runtime = await startBridge(id, config, "test")
    logs.push(`Started ${displayName(id)} bridge at ${runtime.url}.`)

    const health = await waitForHealth(runtime.url)
    logs.push(health.message)
    return { ok: health.ok, logs } as TestById[T]
  } catch (error) {
    const message = cancelled ? "Test aborted." : serializeError(error).message
    logs.push(message)
    return { ok: false, logs } as TestById[T]
  } finally {
    if (activeTests.get(id) === activeTest) activeTests.delete(id)
    await runtime?.stop()
  }
}

async function startBridge<T extends ExtraAgentId>(id: T, config: ConfigById[T], mode: "runtime" | "test") {
  const cli = await bundledCliPath()
  const port = await freePort()
  const url = `http://${HOSTNAME}:${port}`
  const payload = bridgeConfig(id, config)
  const child = spawn(
    cli,
    [
      "extra-agent-serve",
      "--id",
      id,
      "--hostname",
      HOSTNAME,
      "--port",
      String(port),
      "--cors",
      "oc://renderer",
      "--config",
      JSON.stringify(payload),
    ],
    {
      cwd: process.cwd(),
      env: createBridgeEnv(),
      stdio: "pipe",
    },
  )

  let exited = false
  const exit = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      exited = true
      resolve(code)
    })
  })

  child.stdout.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trimEnd()
    if (message) writeLog("extra-agent", "stdout", { id, mode, message })
  })
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trimEnd()
    if (message) writeLog("extra-agent", "stderr", { id, mode, message }, "warn")
  })
  child.on("error", (error) => {
    writeLog("extra-agent", "process error", { id, mode, error: serializeError(error).message }, "error")
  })
  void exit.then((code) => {
    writeLog("extra-agent", "process exited", { id, mode, code }, mode === "runtime" ? "warn" : "info")
    const current = running.get(id)
    if (current?.child === child) running.delete(id)
  })

  const stop = async () => {
    if (exited) return
    child.kill("SIGTERM")
    await Promise.race([
      exit.then(() => undefined),
      delay(STOP_TIMEOUT_MS).then(() => {
        if (!exited) child.kill("SIGKILL")
      }),
    ])
  }

  try {
    await waitForPort(HOSTNAME, port, exit)
  } catch (error) {
    await stop()
    throw error
  }

  return {
    id,
    url,
    hash: configHash(id, config),
    child,
    exit,
    stop,
  } satisfies Runtime
}

async function waitForPort(hostname: string, port: number, exit: Promise<number | null>) {
  const started = Date.now()
  let lastError: Error | undefined

  while (Date.now() - started < START_TIMEOUT_MS) {
    const code = await Promise.race([exit.then((value) => value), delay(100).then(() => undefined)])
    if (code !== undefined) throw new Error(`Bridge exited before listening with code ${code}`)

    const open = await canConnect(hostname, port).catch((error) => {
      lastError = serializeError(error)
      return false
    })
    if (open) return
  }

  throw new Error(`Bridge did not listen on ${hostname}:${port}: ${lastError?.message ?? "timeout"}`)
}

async function waitForHealth(url: string) {
  const started = Date.now()
  let last = "Health check did not run."
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const res = await fetch(new URL("/global/health", url), { signal: AbortSignal.timeout(5000) })
      const body = await res.text().catch(() => "")
      if (res.ok) return { ok: true, message: `Health check passed with status ${res.status}.` }
      last = `Health check failed with status ${res.status}${body ? `: ${body.slice(0, 500)}` : "."}`
      if (res.status >= 400 && res.status < 500) break
    } catch (error) {
      last = `Health check failed: ${serializeError(error).message}`
    }
    await delay(500)
  }
  return { ok: false, message: last }
}

function canConnect(hostname: string, port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: hostname, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 500)
    socket.once("connect", () => {
      clearTimeout(timeout)
      socket.end()
      resolve(true)
    })
    socket.once("error", (error) => {
      clearTimeout(timeout)
      socket.destroy()
      reject(error)
    })
  })
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, HOSTNAME, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to allocate a free port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function readConfig<T extends ExtraAgentId>(id: T): ConfigById[T] {
  if (id === "openclaw") return getOpenclawConfig() as ConfigById[T]
  if (id === "genericagent") return getGenericagentConfig() as ConfigById[T]
  return getHermesConfig() as ConfigById[T]
}

function bridgeConfig<T extends ExtraAgentId>(id: T, config: ConfigById[T]) {
  if (id === "openclaw") {
    const item = config as OpenclawConfig
    return compact({
      gatewayUrl: item.url?.trim(),
      gatewayToken: item.token?.trim(),
    })
  }
  if (id === "genericagent") {
    const item = config as GenericagentConfig
    return compact({
      pythonExecutable: item.pythonExecutable?.trim(),
      genericAgentDir: item.genericAgentDir?.trim(),
    })
  }
  const item = config as HermesConfig
  return compact({
    pythonExecutable: item.pythonExecutable?.trim(),
    hermesDir: item.hermesDir?.trim(),
    hermesHome: item.hermesHome?.trim(),
  })
}

function configHash<T extends ExtraAgentId>(id: T, config: ConfigById[T]) {
  return JSON.stringify({ id, config: bridgeConfig(id, config) })
}

function compact(input: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value && value.length > 0))
}

function createBridgeEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  delete env.OPENCODE_SERVER_PASSWORD
  delete env.OPENCODE_SERVER_USERNAME
  if (process.platform === "linux") delete env.LD_PRELOAD
  env.OPENCODE_CLIENT = "desktop"
  env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"
  env.XDG_STATE_HOME = env.XDG_STATE_HOME ?? app.getPath("userData")
  return env
}

function displayName(id: ExtraAgentId) {
  if (id === "openclaw") return "OpenClaw"
  if (id === "hermes") return "Hermes"
  return "GenericAgent"
}

function order(id: ExtraAgentId) {
  if (id === "openclaw") return 0
  if (id === "hermes") return 1
  return 2
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}
