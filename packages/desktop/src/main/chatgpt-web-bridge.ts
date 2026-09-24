import { randomBytes, randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { app } from "electron"
import { dirname, join } from "node:path"
import { write as writeLog } from "./logging"

const BRIDGE_PORT = 17384
const CHATGPT_URL = "https://chatgpt.com/#opencode-bridge"
const BRIDGE_READY_TIMEOUT = 20_000

export type ChatGPTWebBridgeSettings = {
  host: "127.0.0.1"
  port: number
  key: string
}

let bridgeProcess: ChildProcess | undefined
let bridgeStartup: Promise<void> | undefined
let browserWindowStartup: Promise<void> | undefined
let browserWindowOpenedAt = 0
let settingsQueue = Promise.resolve()

export function getChatGPTWebBridgeSettings(): Promise<ChatGPTWebBridgeSettings> {
  return serializeSettings(async () => {
    const configured = await readFile(connectionPath(), "utf8")
      .then((value) => JSON.parse(value) as { key?: unknown })
      .catch(() => undefined)
    const settings = {
      host: "127.0.0.1",
      port: BRIDGE_PORT,
      key: typeof configured?.key === "string" && configured.key.length >= 32
        ? configured.key
        : randomBytes(32).toString("base64url"),
    } satisfies ChatGPTWebBridgeSettings
    await writeConnectionFile(settings)
    return settings
  })
}

export async function regenerateChatGPTWebBridgeKey() {
  const restart = isBridgeRunning() || bridgeStartup !== undefined
  const settings = await serializeSettings(async () => {
    const next = {
      host: "127.0.0.1",
      port: BRIDGE_PORT,
      key: randomBytes(32).toString("base64url"),
    } satisfies ChatGPTWebBridgeSettings
    await writeConnectionFile(next)
    return next
  })
  if (restart) {
    await bridgeStartup?.catch(() => undefined)
    await stopChatGPTWebBridge()
    await startChatGPTWebBridge()
  }
  return settings
}

export async function activateChatGPTWebModel() {
  await startChatGPTWebBridge()
  await openChatGPTWindow()
}

export async function stopChatGPTWebBridge() {
  const child = bridgeProcess
  bridgeProcess = undefined
  if (!child || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill()
      resolve()
    }, 3_000)
    child.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill()
  })
}

async function startChatGPTWebBridge() {
  if (isBridgeRunning()) return
  if (bridgeStartup) return bridgeStartup
  bridgeStartup = (async () => {
    const directory = process.env.OPENCODE_CHAT_API_PATH
    if (!directory) throw new Error("桌面网页模型运行目录未配置")
    const script = join(directory, "chatgpt_dom_bridge.py")
    const state = statePath()
    const settings = await getChatGPTWebBridgeSettings()
    const env = {
      ...process.env,
      OPENCODE_CHAT_API_STATE_FILE: state,
    }
    const commands: [string, string[]][] =
      process.platform === "win32" ? [["python", []], ["py", ["-3"]]] : [["python3", []], ["python", []]]
    let lastError: unknown
    for (const [command, args] of commands) {
      try {
        const child = await launchBridge(command, [...args, script], env, settings.port)
        bridgeProcess = child
        child.once("exit", (code) => {
          if (bridgeProcess === child) bridgeProcess = undefined
          writeLog("chatgpt-bridge", "bridge process exited", { code }, "warn")
        })
        return
      } catch (error) {
        lastError = error
        if (!isMissingCommand(error)) throw error
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Python 3 is required for the ChatGPT web bridge")
  })().finally(() => {
    bridgeStartup = undefined
  })
  return bridgeStartup
}

function isBridgeRunning() {
  return bridgeProcess !== undefined && bridgeProcess.exitCode === null && !bridgeProcess.killed
}

function isMissingCommand(error: unknown) {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function statePath() {
  return join(app.getPath("userData"), "web-service", "edge-dom-bridge.json")
}

function connectionPath() {
  return join(dirname(statePath()), "edge-dom-bridge-connection.json")
}

async function writeConnectionFile(settings: ChatGPTWebBridgeSettings) {
  const path = connectionPath()
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ port: settings.port, key: settings.key }), { mode: 0o600 })
  await rename(temporary, path)
}

function serializeSettings<T>(run: () => Promise<T>) {
  const result = settingsQueue.then(run)
  settingsQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function launchBridge(command: string, args: string[], env: NodeJS.ProcessEnv, port: number) {
  const directory = process.env.OPENCODE_CHAT_API_PATH
  if (!directory) throw new Error("桌面网页模型运行目录未配置")
  const child = spawn(command, args, {
    cwd: directory,
    env,
    stdio: "pipe",
    windowsHide: true,
  })

  return new Promise<ChildProcess>((resolve, reject) => {
    let output = ""
    let errorOutput = ""
    let complete = false
    const timeout = setTimeout(() => finish(new Error("ChatGPT 本机桥接启动超时")), BRIDGE_READY_TIMEOUT)
    const finish = (error?: Error) => {
      if (complete) return
      complete = true
      clearTimeout(timeout)
      child.stdout?.off("data", onStdout)
      child.stderr?.off("data", onStderr)
      child.off("error", onError)
      child.off("exit", onExit)
      if (error) {
        child.kill()
        reject(error)
        return
      }
      resolve(child)
    }
    const onStdout = (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const lines = output.split(/\r?\n/)
      output = lines.pop() ?? ""
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as { type?: unknown; port?: unknown }
          if (message.type === "ready" && message.port === port) finish()
        } catch {}
      }
    }
    const onStderr = (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8")
      const lines = errorOutput.split(/\r?\n/)
      errorOutput = lines.pop() ?? ""
      for (const line of lines) writeLog("chatgpt-bridge", "stderr", { message: line }, "warn")
    }
    const onError = (error: NodeJS.ErrnoException) => finish(error)
    const onExit = (code: number | null) => {
      finish(new Error(errorOutput.trim() || `ChatGPT 本机桥接意外退出，代码 ${code ?? "unknown"}`))
    }
    child.stdout?.on("data", onStdout)
    child.stderr?.on("data", onStderr)
    child.once("error", onError)
    child.once("exit", onExit)
  })
}

async function openChatGPTWindow() {
  if (browserWindowStartup) return browserWindowStartup
  const opening = (async () => {
    const settings = await getChatGPTWebBridgeSettings()
    const response = await fetch(`http://${settings.host}:${settings.port}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chat-Bridge-Key": settings.key },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error("ChatGPT 本机桥接激活失败")
    const result = (await response.json()) as { connected: boolean }
    if (result.connected || Date.now() - browserWindowOpenedAt < 30_000) return
    // Only bootstrap Edge when its extension is offline. The extension owns
    // the binding and reconciles this marked tab with any existing one.
    const command = await edgeExecutable()
    const args = process.platform === "darwin"
      ? ["-na", "Microsoft Edge", "--args", "--new-window", CHATGPT_URL]
      : ["--new-window", CHATGPT_URL]
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
      child.once("error", reject)
      child.once("spawn", () => {
        child.unref()
        browserWindowOpenedAt = Date.now()
        resolve()
      })
    })
  })()
  browserWindowStartup = opening.finally(() => {
    browserWindowStartup = undefined
  })
  return browserWindowStartup
}

async function edgeExecutable() {
  if (process.platform === "darwin") return "open"
  if (process.platform !== "win32") return "microsoft-edge-stable"
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
    (value): value is string => !!value,
  )
  const candidates = roots.map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) return candidate
  }
  return "msedge"
}
