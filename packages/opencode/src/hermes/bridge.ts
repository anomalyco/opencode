import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import fs from "node:fs/promises"
import path from "node:path"
import { Installation } from "@/installation"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { NamedError } from "@opencode-ai/util/error"
import shimSource from "./python/bridge_shim.py" with { type: "text" }
import { probeHermesMeta } from "./meta"

type Opts = {
  hostname: string
  port: number
  cors?: string[]
  pythonExecutable?: string
  hermesDir?: string
  hermesHome?: string
}

type SessionInfo = {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  time: { created: number; updated: number }
}

type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
}

type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state:
    | {
        status: "running"
        input: Record<string, unknown>
        metadata?: Record<string, unknown>
        time: { start: number }
      }
    | {
        status: "completed"
        input: Record<string, unknown>
        output: string
        metadata?: Record<string, unknown>
        time: { start: number; end: number }
      }
    | {
        status: "error"
        input: Record<string, unknown>
        error: string
        metadata?: Record<string, unknown>
        time: { start: number; end: number }
      }
}

type Part = TextPart | ToolPart

type MessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent: string
  parentID?: string
  providerID: string
  modelID: string
  mode: string
  path: { cwd: string; root: string }
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type Message = {
  info: MessageInfo
  parts: Part[]
}

type Event = { directory: string; payload: { type: string; properties: Record<string, unknown> } }

type ModelInfo = { id: string; name?: string }

type UsageInfo = { input_tokens?: number; output_tokens?: number; total_tokens?: number }

type PromptEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; callID: string; tool: string; input: Record<string, unknown>; raw: string }
  | { type: "tool_done"; callID: string; output: string; raw: unknown }
  | { type: "done"; text: string; responseID?: string; modelID?: string; usage?: UsageInfo }
  | { type: "error"; message: string; responseID?: string }

const log = Log.create({ service: "hermes-bridge" })
const directory = "/hermes"
const projectID = "hermes"
const providerID = "hermes"
const version = Installation.VERSION
const fallbackModelID = "hermes-agent"
const DEFAULT_DIR = "/Users/lelouch/apps/hermes-agent"
const DEFAULT_HOME = process.env.HERMES_HOME

const fileUnsupported =
  "Hermes does not expose a project filesystem through this bridge yet. Use a normal project to browse files, or keep chatting in Hermes without the file tree."

const agent = {
  name: "hermes",
  builtIn: true,
  description: "Hermes Agent runtime",
  mode: "primary" as const,
  model: { providerID, modelID: fallbackModelID },
  prompt: "",
  tools: {},
  permission: { edit: "allow", bash: {}, webfetch: "allow" },
  options: {},
  temperature: 0,
  topP: 1,
}

let shimScriptCache: Promise<string> | undefined

async function materializeShimScript(): Promise<string> {
  if (!shimScriptCache) {
    shimScriptCache = (async () => {
      const hasher = new Bun.CryptoHasher("sha1")
      hasher.update(shimSource)
      const hash = hasher.digest("hex").slice(0, 16)
      const dir = path.join(Global.Path.cache, "hermes")
      const file = path.join(dir, `bridge_shim.${hash}.py`)
      await fs.mkdir(dir, { recursive: true })
      try {
        await fs.access(file)
      } catch {
        await fs.writeFile(file, shimSource, { encoding: "utf8", mode: 0o644 })
      }
      log.info("shim materialized", { file })
      return file
    })().catch((err) => {
      shimScriptCache = undefined
      throw err
    })
  }
  return shimScriptCache
}

function modelDescriptor(id: string, name: string) {
  return {
    id,
    name,
    release_date: "",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    knowledge: "",
    last_updated: "",
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    experimental: true,
  }
}

function buildProvider(list: ModelInfo[]) {
  const models: Record<string, ReturnType<typeof modelDescriptor>> = {}
  const items = list.length > 0 ? list : [{ id: fallbackModelID, name: "Hermes Agent" }]
  for (const item of items) {
    const id = typeof item.id === "string" && item.id ? item.id : fallbackModelID
    models[id] = modelDescriptor(id, item.name || id)
  }
  return {
    id: providerID,
    name: "Hermes",
    env: [] as string[],
    models,
  }
}

function currentModel(list: ModelInfo[]) {
  if (list.length === 0) return fallbackModelID
  const item = list[0]
  if (!item?.id) return fallbackModelID
  return item.id
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseRecord(text: string): Record<string, unknown> {
  const item = parseJson(text)
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return text.trim() ? { raw: text } : {}
  }
  return item as Record<string, unknown>
}

function outputText(item: unknown): string {
  if (!Array.isArray(item)) return ""
  return item
    .flatMap((part) => {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return [(part as { text: string }).text]
      }
      if (!part || typeof part !== "object") return []
      const blocks = (part as { content?: unknown }).content
      if (!Array.isArray(blocks)) return []
      return blocks
        .map((block) => {
          if (!block || typeof block !== "object") return ""
          const text = (block as { text?: unknown }).text
          return typeof text === "string" ? text : ""
        })
        .filter(Boolean)
    })
    .join("")
}

function promptText(parts: unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text")
    .map((item) => ((item as { text?: unknown }).text as string | undefined) ?? "")
    .join("\n")
    .trim()
}

function promptIds(body: unknown): { messageID?: string; partID?: string } {
  if (!body || typeof body !== "object") return {}
  const msg = (body as { messageID?: unknown }).messageID
  const parts = (body as { parts?: Array<{ id?: unknown; messageID?: unknown }> }).parts
  const first = Array.isArray(parts) ? parts[0] : undefined
  return {
    messageID: typeof msg === "string" ? msg : typeof first?.messageID === "string" ? first.messageID : undefined,
    partID: typeof first?.id === "string" ? first.id : undefined,
  }
}

function resolvePython(input: string | undefined, dir: string) {
  if (input) return input
  return path.join(dir, "venv", "bin", "python")
}

class Events {
  private listeners = new Set<(event: Event) => void>()

  on(listener: (event: Event) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: Event) {
    for (const listener of this.listeners) listener(event)
  }
}

type ShimState =
  | { kind: "booting" }
  | { kind: "ready"; port: number }
  | { kind: "error"; message: string }
  | { kind: "stopped" }

class HermesClient {
  private proc?: ReturnType<typeof Bun.spawn>
  private state: ShimState = { kind: "booting" }
  private readyPromise: Promise<void>
  private stdoutTail = ""
  private stderrTail = ""
  private aborts = new Map<string, AbortController>()
  private key = crypto.randomUUID()

  constructor(
    private readonly pythonExecutable: string,
    private readonly hermesDir: string,
    private readonly hermesHome?: string,
  ) {
    this.readyPromise = this.boot()
  }

  private auth() {
    return { Authorization: `Bearer ${this.key}` }
  }

  private async boot(): Promise<void> {
    let shimScript: string
    try {
      shimScript = await materializeShimScript()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.state = { kind: "error", message: `Failed to materialize Hermes shim: ${message}` }
      return
    }

    const cmd = [
      this.pythonExecutable,
      shimScript,
      "--hermes-dir",
      this.hermesDir,
      "--port",
      "0",
      "--key",
      this.key,
      "--model-name",
      fallbackModelID,
    ]
    if (this.hermesHome) {
      cmd.push("--hermes-home", this.hermesHome)
    }

    try {
      this.proc = Bun.spawn(cmd, {
        cwd: this.hermesDir,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        onExit: (_proc, code, signal) => {
          if (this.state.kind === "stopped") return
          const message = `Hermes shim exited (code=${code ?? "?"} signal=${signal ?? "?"}) — ${
            this.stderrTail.slice(-500) || this.stdoutTail.slice(-500) || "no output"
          }`
          log.error("shim exit", { code, signal, stderr: this.stderrTail.slice(-500) })
          this.state = { kind: "error", message }
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.state = { kind: "error", message: `Failed to spawn Hermes python: ${message}` }
      return
    }

    void this.drain(this.proc.stderr as ReadableStream<Uint8Array>, (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4096)
    })

    const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buf = ""
    const end = Date.now() + 20_000
    let done = false

    const scan = () => {
      while (true) {
        const idx = buf.indexOf("\n")
        if (idx < 0) return false
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        if (line.startsWith("LISTEN_PORT:")) {
          const port = Number.parseInt(line.slice("LISTEN_PORT:".length), 10)
          if (Number.isFinite(port) && port > 0) {
            this.state = { kind: "ready", port }
            log.info("shim ready", { port })
            return true
          }
          this.state = { kind: "error", message: `Hermes shim emitted invalid port: ${line}` }
          return true
        }
        if (line.startsWith("BOOT_ERROR:")) {
          const message = line.slice("BOOT_ERROR:".length)
          this.state = { kind: "error", message }
          log.error("shim boot error", { message })
          return true
        }
        log.debug("shim stdout pre-ready", { line })
      }
    }

    while (!done) {
      const left = end - Date.now()
      if (left <= 0) {
        this.state = { kind: "error", message: "Hermes shim boot timed out after 20s" }
        break
      }
      const timer = new Promise<{ done: true; timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ done: true, timedOut: true }), left),
      )
      const next = (await Promise.race([reader.read(), timer])) as
        | { value?: Uint8Array; done: boolean; timedOut?: boolean }
      if (next.timedOut) {
        this.state = { kind: "error", message: "Hermes shim boot timed out after 20s" }
        break
      }
      if (next.done) {
        if (this.state.kind === "booting") {
          this.state = { kind: "error", message: "Hermes shim stdout closed before ready" }
        }
        break
      }
      if (next.value) {
        const chunk = decoder.decode(next.value, { stream: true })
        buf += chunk
        this.stdoutTail = (this.stdoutTail + chunk).slice(-4096)
      }
      done = scan()
    }

    if (this.state.kind === "error") {
      this.stop()
      reader.releaseLock()
      return
    }

    if (this.state.kind !== "ready") {
      reader.releaseLock()
      return
    }

    reader.releaseLock()
    void this.drain(this.proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
      this.stdoutTail = (this.stdoutTail + chunk).slice(-4096)
    })
  }

  private async drain(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        onChunk(decoder.decode(value, { stream: true }))
      }
    } catch {
      // stream errors surface via onExit
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // ignore
      }
    }
  }

  private requireReady() {
    if (this.state.kind === "ready") return this.state.port
    if (this.state.kind === "error") throw new Error(this.state.message)
    throw new Error(`Hermes shim not ready (state=${this.state.kind})`)
  }

  async health(): Promise<{ ok: boolean; model?: string; error?: string }> {
    await this.readyPromise
    if (this.state.kind !== "ready") {
      const message = this.state.kind === "error" ? this.state.message : this.state.kind
      return { ok: false, error: message }
    }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/v1/health`, { headers: this.auth() })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { status?: string }
      const list = await this.models()
      return { ok: data.status === "ok", model: currentModel(list) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async models(): Promise<ModelInfo[]> {
    await this.readyPromise
    if (this.state.kind !== "ready") return []
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/v1/models`, { headers: this.auth() })
      if (!res.ok) return []
      const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> }
      if (!Array.isArray(data.data)) return []
      return data.data
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : fallbackModelID,
          name: typeof item.name === "string" ? item.name : undefined,
        }))
        .filter((item) => !!item.id)
    } catch (err) {
      log.warn("models request failed", { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  async abort(sessionID: string) {
    const ctrl = this.aborts.get(sessionID)
    if (!ctrl) return
    log.info("aborting prompt", { sessionID })
    this.aborts.delete(sessionID)
    ctrl.abort()
  }

  async prompt(sessionID: string, query: string, responseID: string | undefined, onEvent: (event: PromptEvent) => void) {
    await this.readyPromise
    const port = this.requireReady()
    const ctrl = new AbortController()
    this.aborts.set(sessionID, ctrl)

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          ...this.auth(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: query,
          stream: true,
          previous_response_id: responseID,
          store: true,
        }),
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(`Hermes /v1/responses failed (${res.status}): ${text.slice(0, 300)}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let final = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        while (true) {
          const idx = buf.indexOf("\n\n")
          if (idx < 0) break
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const lines = raw
            .split("\n")
            .map((line) => line.trimEnd())
            .filter(Boolean)
          if (lines.length === 0) continue
          let name = ""
          const data: string[] = []
          for (const line of lines) {
            if (line.startsWith(":")) continue
            if (line.startsWith("event:")) {
              name = line.slice("event:".length).trim()
              continue
            }
            if (line.startsWith("data:")) data.push(line.slice("data:".length).trim())
          }
          if (!name || data.length === 0) continue
          const item = parseJson(data.join("\n")) as Record<string, unknown> | undefined
          if (!item) continue

          if (name === "response.output_text.delta") {
            const delta = typeof item.delta === "string" ? item.delta : ""
            if (!delta) continue
            final += delta
            onEvent({ type: "delta", text: delta })
            continue
          }

          if (name === "response.output_item.added") {
            const part = item.item
            if (!part || typeof part !== "object") continue
            const type = (part as { type?: unknown }).type
            if (type === "function_call") {
              const callID = typeof (part as { call_id?: unknown }).call_id === "string"
                ? (part as { call_id: string }).call_id
                : Identifier.ascending("tool")
              const tool = typeof (part as { name?: unknown }).name === "string" ? (part as { name: string }).name : "tool"
              const raw = typeof (part as { arguments?: unknown }).arguments === "string"
                ? (part as { arguments: string }).arguments
                : ""
              onEvent({
                type: "tool_start",
                callID,
                tool,
                input: parseRecord(raw),
                raw,
              })
            }
            continue
          }

          if (name === "response.output_item.done") {
            const part = item.item
            if (!part || typeof part !== "object") continue
            const type = (part as { type?: unknown }).type
            if (type !== "function_call_output") continue
            const callID = typeof (part as { call_id?: unknown }).call_id === "string"
              ? (part as { call_id: string }).call_id
              : ""
            const output = outputText((part as { output?: unknown }).output)
            onEvent({ type: "tool_done", callID, output, raw: (part as { output?: unknown }).output })
            continue
          }

          if (name === "response.completed") {
            const resp = item.response
            if (!resp || typeof resp !== "object") continue
            const text = outputText((resp as { output?: unknown }).output) || final
            const modelID = typeof (resp as { model?: unknown }).model === "string"
              ? (resp as { model: string }).model
              : fallbackModelID
            const responseID = typeof (resp as { id?: unknown }).id === "string"
              ? (resp as { id: string }).id
              : undefined
            const usage = (resp as { usage?: UsageInfo }).usage
            onEvent({ type: "done", text, responseID, modelID, usage })
            return
          }

          if (name === "response.failed") {
            const resp = item.response
            const responseID = resp && typeof resp === "object" && typeof (resp as { id?: unknown }).id === "string"
              ? (resp as { id: string }).id
              : undefined
            const err = item.error
            let message = "Hermes request failed"
            if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
              message = (err as { message: string }).message
            }
            if (resp && typeof resp === "object") {
              const hit = outputText((resp as { output?: unknown }).output)
              if (hit) final = hit
            }
            onEvent({ type: "error", message, responseID })
            return
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        log.info("prompt aborted", { sessionID })
        return
      }
      throw err
    } finally {
      this.aborts.delete(sessionID)
    }
  }

  stop() {
    if (this.state.kind === "stopped") return
    this.state = { kind: "stopped" }
    for (const ctrl of this.aborts.values()) ctrl.abort()
    this.aborts.clear()
    try {
      this.proc?.kill("SIGTERM")
    } catch {
      // ignore
    }
  }
}

function welcomeSession(): SessionInfo {
  const created = Date.now()
  return {
    id: "welcome",
    slug: "welcome",
    projectID,
    directory,
    title: "Welcome to Hermes",
    version,
    time: { created, updated: created },
  }
}

function welcomeMessages(): Message[] {
  const info: MessageInfo = {
    id: Identifier.ascending("message"),
    sessionID: "welcome",
    role: "assistant",
    time: { created: Date.now(), completed: Date.now() },
    agent: "hermes",
    providerID,
    modelID: fallbackModelID,
    mode: "default",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const part: TextPart = {
    id: Identifier.ascending("part"),
    messageID: info.id,
    sessionID: "welcome",
    type: "text",
    text:
      "Hermes is wired through its local API-server adapter. Start a new conversation to chat with Hermes from inside GeneralAgent.",
  }
  return [{ info, parts: [part] }]
}

function userMessage(sessionID: string, text: string, modelID: string, ids?: { messageID?: string; partID?: string }): Message {
  const messageID = ids?.messageID ?? Identifier.ascending("message")
  const partID = ids?.partID ?? Identifier.ascending("part")
  const info: MessageInfo = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "hermes",
    providerID,
    modelID,
    mode: "default",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const part: TextPart = {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text,
  }
  return { info, parts: [part] }
}

function assistantMessage(sessionID: string, parentID: string, modelID: string): Message {
  const info: MessageInfo = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    agent: "hermes",
    parentID,
    providerID,
    modelID,
    mode: "default",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  return { info, parts: [] }
}

export namespace HermesBridge {
  export function createApp(opts: Opts) {
    const dir = opts.hermesDir || DEFAULT_DIR
    const python = resolvePython(opts.pythonExecutable, dir)
    const home = opts.hermesHome || DEFAULT_HOME
    const shim = new HermesClient(python, dir, home)
    const meta = probeHermesMeta({ python, dir })
      .then((item) => {
        log.debug("hermes startup meta loaded", {
          dir,
          version: item.version ?? null,
          upstream: item.upstream ?? null,
          total: item.total,
          rows: item.rows.length,
        })
        return item
      })
      .catch((err) => {
        log.warn("hermes startup meta probe failed", {
          dir,
          error: err instanceof Error ? err.message : String(err),
        })
        return undefined
      })
    const events = new Events()
    const sessions = new Map<string, SessionInfo>()
    const messages = new Map<string, Message[]>()
    const chains = new Map<string, { responseID?: string }>()
    const locks = new Map<string, Promise<unknown>>()

    sessions.set("welcome", welcomeSession())
    messages.set("welcome", welcomeMessages())
    chains.set("welcome", {})

    const emit = (payload: Event["payload"]) => events.emit({ directory, payload })
    const emitStatus = (sessionID: string, kind: "busy" | "idle") =>
      emit({ type: "session.status", properties: { sessionID, status: { type: kind } } })

    const serialize = async <T>(sessionID: string, fn: () => Promise<T>): Promise<T> => {
      const prev = locks.get(sessionID) ?? Promise.resolve()
      const next = prev.catch(() => undefined).then(fn)
      locks.set(sessionID, next.catch(() => undefined))
      return next
    }

    const createSession = (sessionID: string, title: string, parentID?: string) => {
      const now = Date.now()
      const info: SessionInfo = {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version,
        time: { created: now, updated: now },
      }
      sessions.set(sessionID, info)
      messages.set(sessionID, [])
      const prev = parentID ? chains.get(parentID) : undefined
      chains.set(sessionID, { responseID: prev?.responseID })
      emit({ type: "session.created", properties: { info } })
      return info
    }

    const app = new Hono()
      .onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("request failed", { error: message })
        return c.json(new NamedError.Unknown({ message }).toObject(), { status: 500 })
      })
      .use((c, next) => {
        const password = process.env.OPENCODE_SERVER_PASSWORD
        if (!password || c.req.method === "OPTIONS") return next()
        return basicAuth({ username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password })(c, next)
      })
      .use(
        cors({
          origin(input) {
            if (!input) return
            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost") {
              return input
            }
            if (opts.cors?.includes(input)) return input
          },
        }),
      )
      .get("/global/health", async (c) => {
        const health = await shim.health()
        if (health.ok) return c.json({ healthy: true, version, model: health.model ?? fallbackModelID })
        return c.json(new NamedError.Unknown({ message: health.error ?? "Hermes unavailable" }).toObject(), { status: 503 })
      })
      .get("/global/config", async (c) => {
        const list = await shim.models()
        return c.json({ model: `${providerID}/${currentModel(list)}` })
      })
      .patch("/global/config", async (c) => {
        const list = await shim.models()
        log.debug("ignoring /global/config patch", { model: `${providerID}/${currentModel(list)}` })
        return c.json({ model: `${providerID}/${currentModel(list)}` })
      })
      .post("/global/dispose", (c) => {
        log.info("disposing hermes bridge")
        shim.stop()
        return c.json(true)
      })
      .get("/global/event", async (c) => {
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.connected", properties: {} } }) })
          const off = events.on((event) => {
            void stream.writeSSE({ data: JSON.stringify(event) })
          })
          const timer = setInterval(() => {
            stream.writeSSE({ data: JSON.stringify({ payload: { type: "server.heartbeat", properties: {} } }) })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              off()
              clearInterval(timer)
              resolve()
            })
          })
        })
      })
      .get("/path", (c) =>
        c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: directory,
          directory,
        }),
      )
      .get("/project", (c) =>
        c.json([
          {
            id: projectID,
            worktree: directory,
            name: "Hermes",
            time: { created: Date.now(), updated: Date.now() },
            sandboxes: [],
          },
        ]),
      )
      .get("/project/current", (c) =>
        c.json({
          id: projectID,
          worktree: directory,
          name: "Hermes",
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        }),
      )
      .get("/provider", async (c) => {
        const list = await shim.models()
        const modelID = currentModel(list)
        return c.json({
          all: [buildProvider(list)],
          default: { [providerID]: `${providerID}/${modelID}` },
          connected: [providerID],
        })
      })
      .get("/provider/auth", (c) => c.json({}))
      .get("/config", (c) => c.json({}))
      .get("/command", (c) => c.json([]))
      .get("/agent", async (c) => {
        const list = await shim.models()
        const item = await meta
        return c.json([
          {
            ...agent,
            model: { providerID, modelID: currentModel(list) },
            options: {
              ...agent.options,
              hermes: item,
            },
          },
        ])
      })
      .get("/skill", (c) => c.json([]))
      .get("/mcp", (c) => c.json({}))
      .get("/lsp", (c) => c.json([]))
      .get("/vcs", (c) => c.json({ branch: "hermes" }))
      .get("/file", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/content", () => {
        throw new Error(fileUnsupported)
      })
      .get("/file/status", (c) => c.json([]))
      .get("/permission", (c) => c.json([]))
      .get("/question", (c) => c.json([]))
      .get("/session/status", (c) => c.json({}))
      .get("/session", (c) => c.json(Array.from(sessions.values())))
      .post("/session", async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as { id?: string; title?: string; parentID?: string }
        const sessionID = body.id || Identifier.ascending("session")
        const title = body.title || "New Conversation"
        createSession(sessionID, title, body.parentID)
        return c.json(sessions.get(sessionID))
      })
      .delete("/session/:sessionID", (c) => {
        const sessionID = c.req.param("sessionID")
        const info = sessions.get(sessionID)
        if (!info) return c.json(true)
        sessions.delete(sessionID)
        messages.delete(sessionID)
        chains.delete(sessionID)
        emit({ type: "session.deleted", properties: { info } })
        return c.json(true)
      })
      .get("/session/:sessionID", (c) => {
        const sessionID = c.req.param("sessionID")
        const info = sessions.get(sessionID)
        if (info) return c.json(info)
        return c.json({
          id: sessionID,
          slug: sessionID,
          projectID,
          directory,
          title: sessionID,
          version,
          time: { created: Date.now(), updated: Date.now() },
        } satisfies SessionInfo)
      })
      .get("/session/:sessionID/todo", (c) => c.json([]))
      .get("/session/:sessionID/children", (c) => c.json([]))
      .get("/session/:sessionID/message", (c) => {
        const sessionID = c.req.param("sessionID")
        return c.json(messages.get(sessionID) ?? [])
      })
      .post("/session/:sessionID/abort", async (c) => {
        const sessionID = c.req.param("sessionID")
        await shim.abort(sessionID)
        emitStatus(sessionID, "idle")
        return c.json(true)
      })
      .post("/session/:sessionID/prompt_async", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = await c.req.json().catch(() => ({}))
        const query = promptText((body as { parts?: unknown }).parts)
        if (!query) {
          return c.json(new NamedError.Unknown({ message: "empty prompt" }).toObject(), { status: 400 })
        }

        const list = await shim.models()
        const modelID = currentModel(list)
        if (!sessions.has(sessionID)) createSession(sessionID, query.slice(0, 60) || sessionID)

        const user = userMessage(sessionID, query, modelID, promptIds(body))
        const assistant = assistantMessage(sessionID, user.info.id, modelID)
        const bucket = messages.get(sessionID) ?? []
        bucket.push(user, assistant)
        messages.set(sessionID, bucket)

        emitStatus(sessionID, "busy")
        emit({ type: "message.updated", properties: { info: assistant.info } })

        void serialize(sessionID, async () => {
          let text = ""
          const state = chains.get(sessionID) ?? {}
          const tools = new Map<string, ToolPart>()
          let reply: TextPart | undefined
          const makeText = (value = "") => {
            if (reply) return reply
            reply = {
              id: Identifier.ascending("part"),
              sessionID,
              messageID: assistant.info.id,
              type: "text",
              text: value,
            }
            assistant.parts.push(reply)
            log.info("text part created", { sessionID, partID: reply.id, len: value.length })
            emit({ type: "message.part.updated", properties: { part: reply } })
            return reply
          }
          log.info("prompt start", { sessionID, hasPrev: !!state.responseID })
          try {
            await shim.prompt(sessionID, query, state.responseID, (event) => {
              if (event.type === "delta") {
                text += event.text
                const part = makeText()
                emit({
                  type: "message.part.delta",
                  properties: {
                    sessionID,
                    messageID: assistant.info.id,
                    partID: part.id,
                    field: "text",
                    delta: event.text,
                  },
                })
                return
              }

              if (event.type === "tool_start") {
                const now = Date.now()
                const part: ToolPart = {
                  id: Identifier.ascending("part"),
                  sessionID,
                  messageID: assistant.info.id,
                  type: "tool",
                  callID: event.callID,
                  tool: event.tool,
                  state: {
                    status: "running",
                    input: event.input,
                    metadata: { raw: event.raw },
                    time: { start: now },
                  },
                }
                tools.set(event.callID, part)
                assistant.parts.push(part)
                log.info("tool start", { sessionID, tool: event.tool, callID: event.callID })
                emit({ type: "message.part.updated", properties: { part } })
                return
              }

              if (event.type === "tool_done") {
                const part = tools.get(event.callID)
                if (!part) return
                const start = part.state.time.start
                part.state = {
                  status: "completed",
                  input: part.state.input,
                  output: event.output,
                  metadata: { raw: event.raw },
                  time: { start, end: Date.now() },
                }
                log.info("tool done", { sessionID, tool: part.tool, callID: event.callID })
                emit({ type: "message.part.updated", properties: { part } })
                return
              }

              if (event.type === "done") {
                const final = event.text || text
                if (final) {
                  const part = makeText(final)
                  part.text = final
                  emit({ type: "message.part.updated", properties: { part: { ...part, text: final } } })
                }
                assistant.info.modelID = event.modelID || assistant.info.modelID
                assistant.info.time.completed = Date.now()
                assistant.info.tokens = {
                  input: event.usage?.input_tokens ?? 0,
                  output: event.usage?.output_tokens ?? 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                }
                state.responseID = event.responseID ?? state.responseID
                chains.set(sessionID, state)
                emit({ type: "message.updated", properties: { info: assistant.info } })
                const info = sessions.get(sessionID)
                if (!info) return
                const next = {
                  ...info,
                  title: info.title === "New Conversation" ? query.slice(0, 60) || info.title : info.title,
                  time: { ...info.time, updated: Date.now() },
                }
                sessions.set(sessionID, next)
                log.info("response completed", { sessionID, responseID: state.responseID, modelID: assistant.info.modelID })
                emit({ type: "session.updated", properties: { info: next } })
                return
              }

              if (event.type === "error") {
                if (event.responseID) {
                  state.responseID = event.responseID
                  chains.set(sessionID, state)
                }
                log.error("response failed", { sessionID, error: event.message })
                emit({
                  type: "session.error",
                  properties: {
                    sessionID,
                    error: { name: "UnknownError", data: { message: event.message } },
                  },
                })
              }
            })
          } catch (err) {
            const aborted = err instanceof Error && err.name === "AbortError"
            if (!aborted) {
              const message = err instanceof Error ? err.message : String(err)
              log.error("prompt failed", { sessionID, error: message })
              emit({
                type: "session.error",
                properties: {
                  sessionID,
                  error: { name: "UnknownError", data: { message } },
                },
              })
            }
          } finally {
            emitStatus(sessionID, "idle")
          }
        })

        return c.body(null, 204)
      })
      .post("/session/:sessionID/message", async (c) => {
        return c.json(new NamedError.Unknown({ message: "Use prompt_async for Hermes messaging" }).toObject(), {
          status: 400,
        })
      })

    return { app, dispose: () => shim.stop() }
  }

  export function listen(opts: Opts) {
    const { app, dispose } = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4098) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)
    return {
      hostname: server.hostname,
      port: server.port,
      stop() {
        try {
          dispose()
        } catch {
          // ignore
        }
        return server.stop()
      },
    }
  }
}
