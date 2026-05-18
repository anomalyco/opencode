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

// Cursor encode/decode for pagination (mirrors packages/opencode/src/session/message-v2.ts)
const cursorEncode = (input: { id: string; time: number }) =>
  Buffer.from(JSON.stringify(input)).toString("base64url")

const cursorDecode = (input: string): { id: string; time: number } | undefined => {
  try {
    return JSON.parse(Buffer.from(input, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}



type Opts = {
  hostname: string
  port: number
  cors?: string[]
  pythonExecutable?: string
  genericAgentDir?: string
}

const log = Log.create({ service: "genericagent" })
const directory = "/genericagent"
const projectID = "genericagent"
const providerID = "genericagent"
const modelID = "python"
const version = Installation.VERSION

const fileUnsupported =
  "GenericAgent does not expose a project filesystem yet. Use a normal project to browse files, or keep chatting in GenericAgent without the file tree."

const DEFAULT_GA_DIR = "/Users/lelouch/apps/GenericAgent"
const DEFAULT_PYTHON = "python3"

let shimScriptCache: Promise<string> | undefined
async function materializeShimScript(): Promise<string> {
  if (!shimScriptCache) {
    shimScriptCache = (async () => {
      const hasher = new Bun.CryptoHasher("sha1")
      hasher.update(shimSource)
      const hash = hasher.digest("hex").slice(0, 16)
      const dir = path.join(Global.Path.cache, "genericagent")
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
  tool: string
  state:
    | {
        status: "running"
        input: Record<string, unknown>
      }
    | {
        status: "completed"
        input: Record<string, unknown>
        output: string
        metadata?: Record<string, unknown>
      }
    | {
        status: "error"
        input: Record<string, unknown>
        output: string
        error: string
        metadata?: Record<string, unknown>
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

type HistorySession = {
  id: string
  path: string
  mtime: number
  preview: string
  rounds: number
}

type HistoryMessage = {
  role: "user" | "assistant"
  content: string
}

function llmModelID(index: number): string {
  return `llm_${index}`
}

function parseLlmIndex(id: string | undefined): number | undefined {
  if (!id) return undefined
  const m = /^llm_(\d+)$/.exec(id)
  return m ? Number.parseInt(m[1], 10) : undefined
}

function modelDescriptor(id: string, name: string) {
  return {
    id,
    name,
    release_date: "",
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: false,
    knowledge: "",
    last_updated: "",
    cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    limit: { context: 0, output: 0 },
    experimental: true,
  }
}

const placeholderModelID = modelID

function buildProvider(llms: Array<{ index: number; name: string; current: boolean }>) {
  if (llms.length === 0) {
    return {
      id: providerID,
      name: "GenericAgent",
      env: [] as string[],
      models: { [placeholderModelID]: modelDescriptor(placeholderModelID, "GenericAgent (Python)") },
    }
  }
  const models: Record<string, ReturnType<typeof modelDescriptor>> = {}
  for (const item of llms) {
    const id = llmModelID(item.index)
    models[id] = modelDescriptor(id, item.name || id)
  }
  return {
    id: providerID,
    name: "GenericAgent",
    env: [] as string[],
    models,
  }
}

function currentModelID(llms: Array<{ index: number; name: string; current: boolean }>): string {
  if (llms.length === 0) return placeholderModelID
  const current = llms.find((item) => item.current) ?? llms[0]
  return llmModelID(current.index)
}

const agent = {
  name: "genericagent",
  builtIn: true,
  description: "Python GenericAgent runtime",
  mode: "primary" as const,
  model: { providerID, modelID },
  prompt: "",
  tools: {},
  permission: { edit: "allow", bash: {}, webfetch: "allow" },
  options: {},
  temperature: 0,
  topP: 1,
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

class ShimClient {
  private proc?: ReturnType<typeof Bun.spawn>
  private state: ShimState = { kind: "booting" }
  private readyPromise: Promise<void>
  private stdoutTail = ""
  private stderrTail = ""
  private aborts = new Map<string, AbortController>()

  constructor(
    private readonly pythonExecutable: string,
    private readonly genericAgentDir: string,
  ) {
    this.readyPromise = this.boot()
  }

  private async boot(): Promise<void> {
    let shimScript: string
    try {
      shimScript = await materializeShimScript()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.state = { kind: "error", message: `Failed to materialize shim: ${message}` }
      return
    }

    try {
      this.proc = Bun.spawn(
        [this.pythonExecutable, shimScript, "--ga-dir", this.genericAgentDir, "--port", "0"],
        {
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          onExit: (_proc, exitCode, signalCode) => {
            if (this.state.kind !== "stopped") {
              const message = `GenericAgent shim exited (code=${exitCode ?? "?"} signal=${signalCode ?? "?"}) — ${
                this.stderrTail.slice(-500) || this.stdoutTail.slice(-500) || "no output"
              }`
              log.error("shim exit", { exitCode, signalCode, stderr: this.stderrTail.slice(-500) })
              this.state = { kind: "error", message }
            }
          },
        },
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.state = { kind: "error", message: `Failed to spawn python: ${message}` }
      return
    }

    void this.drain(this.proc.stderr as ReadableStream<Uint8Array>, (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4096)
    })

    const stdoutReader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const timeoutMs = 15_000
    const deadline = Date.now() + timeoutMs
    let settled = false

    const processBuffer = (): boolean => {
      while (true) {
        const newlineIdx = buffer.indexOf("\n")
        if (newlineIdx < 0) return false
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue
        if (line.startsWith("LISTEN_PORT:")) {
          const port = Number.parseInt(line.slice("LISTEN_PORT:".length), 10)
          if (Number.isFinite(port) && port > 0) {
            this.state = { kind: "ready", port }
            log.info("shim ready", { port })
            return true
          }
          this.state = { kind: "error", message: `shim emitted invalid port: ${line}` }
          return true
        }
        if (line.startsWith("BOOT_ERROR:")) {
          this.state = { kind: "error", message: line.slice("BOOT_ERROR:".length) }
          log.error("shim boot error", { message: (this.state as { message: string }).message })
          return true
        }
        log.debug("shim stdout pre-ready", { line })
      }
    }

    while (!settled) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        this.state = { kind: "error", message: "shim boot timed out after 15s" }
        break
      }
      const timer = new Promise<{ value?: undefined; done: true; timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ done: true, timedOut: true }), remaining),
      )
      const result = (await Promise.race([stdoutReader.read(), timer])) as
        | { value?: Uint8Array; done: boolean; timedOut?: boolean }
      if (result.timedOut) {
        this.state = { kind: "error", message: "shim boot timed out after 15s" }
        break
      }
      if (result.done) {
        if (this.state.kind === "booting") this.state = { kind: "error", message: "shim stdout closed before ready" }
        break
      }
      if (result.value) {
        const chunk = decoder.decode(result.value, { stream: true })
        buffer += chunk
        this.stdoutTail = (this.stdoutTail + chunk).slice(-4096)
      }
      settled = processBuffer()
    }

    if (this.state.kind === "error") {
      this.stop()
      stdoutReader.releaseLock()
      return
    }

    if (this.state.kind === "ready") {
      stdoutReader.releaseLock()
      void this.drain(this.proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
        this.stdoutTail = (this.stdoutTail + chunk).slice(-4096)
      })
    }
  }

  private async drain(stream: ReadableStream<Uint8Array>, onChunk: (chunk: string) => void): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
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

  async ready(): Promise<void> {
    await this.readyPromise
  }

  getState(): ShimState {
    return this.state
  }

  private requireReady(): number {
    if (this.state.kind !== "ready") {
      throw new Error(
        this.state.kind === "error" ? this.state.message : `GenericAgent shim not ready (state=${this.state.kind})`,
      )
    }
    return this.state.port
  }

  async health(): Promise<{ ok: boolean; model?: string; error?: string }> {
    await this.readyPromise
    if (this.state.kind !== "ready") return { ok: false, error: (this.state as { message?: string }).message ?? this.state.kind }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/health`)
      return (await res.json()) as { ok: boolean; model?: string; error?: string }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async reset(): Promise<void> {
    await this.readyPromise
    if (this.state.kind !== "ready") return
    try {
      await fetch(`http://127.0.0.1:${this.state.port}/reset`, { method: "POST" })
    } catch (e) {
      log.warn("shim reset failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  async snapshotLog(): Promise<void> {
    await this.readyPromise
    if (this.state.kind !== "ready") return
    try {
      await fetch(`http://127.0.0.1:${this.state.port}/snapshot`, { method: "POST" })
    } catch (e) {
      log.warn("shim snapshot failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  async abort(sessionID: string): Promise<void> {
    const t0 = Date.now()
    const ctrl = this.aborts.get(sessionID)
    if (ctrl) {
      log.info("ShimClient.abort: cancel local fetch", { sessionID })
      this.aborts.delete(sessionID)
      try {
        ctrl.abort()
      } catch (e) {
        log.warn("ShimClient.abort: ctrl.abort failed", { error: e instanceof Error ? e.message : String(e) })
      }
    } else {
      log.info("ShimClient.abort: no active fetch", { sessionID, activeCount: this.aborts.size })
    }
    await this.readyPromise
    if (this.state.kind !== "ready") {
      log.info("ShimClient.abort: shim not ready, skip POST /abort", { sessionID, state: this.state.kind })
      return
    }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/abort`, { method: "POST" })
      log.info("ShimClient.abort: POST /abort done", { sessionID, status: res.status, totalMs: Date.now() - t0 })
    } catch (e) {
      log.warn("ShimClient.abort: POST /abort failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  async listLlms(): Promise<Array<{ index: number; name: string; current: boolean }>> {
    await this.readyPromise
    if (this.state.kind !== "ready") return []
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/llms`)
      if (!res.ok) return []
      const data = (await res.json()) as Array<{ index: number; name: string; current: boolean }>
      return Array.isArray(data) ? data : []
    } catch (e) {
      log.warn("shim listLlms failed", { error: e instanceof Error ? e.message : String(e) })
      return []
    }
  }

  async selectLlm(index: number): Promise<{ ok: boolean; model?: string; error?: string }> {
    await this.readyPromise
    if (this.state.kind !== "ready") return { ok: false, error: (this.state as { message?: string }).message ?? this.state.kind }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; model?: string; error?: string }
      if (!res.ok || data.ok !== true) {
        return { ok: false, error: data.error ?? `HTTP ${res.status}` }
      }
      return { ok: true, model: data.model }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.warn("shim selectLlm failed", { index, error: message })
      return { ok: false, error: message }
    }
  }

  async listHistorySessions(): Promise<HistorySession[]> {
    await this.readyPromise
    if (this.state.kind !== "ready") {
      return []
    }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/sessions`)
      if (!res.ok) {
        return []
      }
      const data = (await res.json()) as HistorySession[]
      const sessions = Array.isArray(data) ? data : []
      return sessions
    } catch {
      return []
    }
  }

  async getHistoryMessages(sessionId: string): Promise<HistoryMessage[]> {
    await this.readyPromise
    if (this.state.kind !== "ready") {
      return []
    }
    try {
      const url = `http://127.0.0.1:${this.state.port}/sessions/${encodeURIComponent(sessionId)}/messages`
      const res = await fetch(url)
      if (!res.ok) {
        return []
      }
      const data = (await res.json()) as HistoryMessage[]
      const messages = Array.isArray(data) ? data : []
      return messages
    } catch {
      return []
    }
  }

  async restoreSession(
    sessionId: string,
  ): Promise<{ ok: boolean; message?: string; full?: boolean; error?: string }> {
    await this.readyPromise
    if (this.state.kind !== "ready") {
      return { ok: false, error: (this.state as { message?: string }).message ?? this.state.kind }
    }
    try {
      const res = await fetch(`http://127.0.0.1:${this.state.port}/sessions/${encodeURIComponent(sessionId)}/restore`, {
        method: "POST",
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        full?: boolean
        error?: string
      }
      if (!res.ok) {
        return { ok: false, error: data.error ?? `HTTP ${res.status}` }
      }
      return {
        ok: data.ok === true,
        message: data.message,
        full: data.full,
        error: data.ok === true ? undefined : data.error,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.warn("shim restoreSession failed", { sessionId, error: message })
      return { ok: false, error: message }
    }
  }

  async prompt(
    sessionID: string,
    query: string,
    onEvent: (event:
      | { type: "delta"; text: string }
      | { type: "done"; text: string }
      | { type: "error"; message: string }
      | { type: "tool_use"; data: { type: string; tool: string; id: string; input?: any; output?: any; status?: string; metadata?: any } }
    ) => void,
  ): Promise<void> {
    await this.readyPromise
    const port = this.requireReady()
    const prev = this.aborts.get(sessionID)
    if (prev) {
      log.warn("genericagent prompt: stale abort controller, replacing", { sessionID })
      try {
        prev.abort()
      } catch {
        // ignore
      }
    }
    const ctrl = new AbortController()
    this.aborts.set(sessionID, ctrl)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(`shim /prompt failed (${res.status}): ${text.slice(0, 200)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        while (true) {
          const separator = buffer.indexOf("\n\n")
          if (separator < 0) break
          const rawEvent = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"))
          if (!dataLine) continue
          const payload = dataLine.slice("data:".length).trim()
          if (!payload) continue
          try {
            const parsed = JSON.parse(payload) as
              | { type: "delta"; text: string }
              | { type: "done"; text: string }
              | { type: "error"; message: string }
              | { type: "tool_use"; data: any }
            onEvent(parsed as any)
            if (parsed.type === "done" || parsed.type === "error") {
              try {
                reader.releaseLock()
              } catch {
                // ignore
              }
              return
            }
          } catch (e) {
            log.warn("shim event parse failed", { error: e instanceof Error ? e.message : String(e), payload })
          }
        }
      }
    } finally {
      // Only clear the slot if it still points at our controller (abort() may have removed it already).
      if (this.aborts.get(sessionID) === ctrl) this.aborts.delete(sessionID)
    }
  }

  stop(): void {
    if (this.state.kind === "stopped") return
    this.state = { kind: "stopped" }
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
    title: "Welcome to GenericAgent",
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
    agent: "genericagent",
    providerID,
    modelID: placeholderModelID,
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
      "👋 GenericAgent is wired to your local Python runtime. Create a new conversation and start chatting — the agent will execute against its full tool loop.",
  }
  return [{ info, parts: [part] }]
}

function extractPrompt(body: unknown): string {
  if (!body || typeof body !== "object") return ""
  const parts = (body as { parts?: Array<{ type?: string; text?: string }> }).parts
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim()
}

function extractPromptIds(body: unknown): { messageID?: string; partID?: string } {
  if (!body || typeof body !== "object") return {}
  const messageID = (body as { messageID?: unknown }).messageID
  const parts = (body as { parts?: Array<{ id?: unknown; messageID?: unknown }> }).parts
  const firstPart = Array.isArray(parts) ? parts[0] : undefined
  return {
    messageID: typeof messageID === "string" ? messageID : typeof firstPart?.messageID === "string" ? firstPart.messageID : undefined,
    partID: typeof firstPart?.id === "string" ? firstPart.id : undefined,
  }
}

function userMessage(sessionID: string, text: string, currentModelID: string, ids?: { messageID?: string; partID?: string }): Message {
  const messageID = ids?.messageID ?? Identifier.ascending("message")
  const partID = ids?.partID ?? Identifier.ascending("part")
  const info: MessageInfo = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "genericagent",
    providerID,
    modelID: currentModelID,
    mode: "default",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const part: TextPart = {
    id: partID,
    messageID,
    sessionID,
    type: "text",
    text,
  }
  return { info, parts: [part] }
}

function assistantMessage(sessionID: string, parentID: string, currentModelID: string): Message {
  const info: MessageInfo = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    agent: "genericagent",
    parentID,
    providerID,
    modelID: currentModelID,
    mode: "default",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  return { info, parts: [] }
}

function trimSessionTitle(title: string): string {
  return title.trim().slice(0, 60) || "Historical Conversation"
}

function historySessionInfo(session: HistorySession): SessionInfo {
  const timestamp = Math.round(session.mtime * 1000)
  return {
    id: session.id,
    slug: session.id,
    projectID,
    directory,
    title: trimSessionTitle(session.preview),
    version,
    time: { created: timestamp, updated: timestamp },
  }
}

function historyMessagesToBridge(sessionID: string, timestamp: number, items: HistoryMessage[]): Message[] {
  let lastUserMessageID: string | undefined
  return items.map((item) => {
    const messageID = Identifier.ascending("message")
    const info: MessageInfo = {
      id: messageID,
      sessionID,
      role: item.role,
      time: {
        created: timestamp,
        ...(item.role === "assistant" ? { completed: timestamp } : {}),
      },
      agent: "genericagent",
      ...(item.role === "assistant" && lastUserMessageID ? { parentID: lastUserMessageID } : {}),
      providerID,
      modelID,
      mode: "default",
      path: { cwd: directory, root: directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    const part: TextPart = {
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "text",
      text: item.content,
    }
    if (item.role === "user") lastUserMessageID = messageID
    return { info, parts: [part] }
  })
}

export namespace GenericAgentBridge {
  export function createApp(opts: Opts) {
    const pythonExecutable = opts.pythonExecutable || DEFAULT_PYTHON
    const genericAgentDir = opts.genericAgentDir || DEFAULT_GA_DIR
    const shim = new ShimClient(pythonExecutable, genericAgentDir)
    const events = new Events()
    const sessions = new Map<string, SessionInfo>()
    const messages = new Map<string, Message[]>()
    const sessionLock = new Map<string, Promise<unknown>>()
    const historySessionIDs = new Set<string>()

    sessions.set("welcome", welcomeSession())
    messages.set("welcome", welcomeMessages())

    const emit = (payload: Event["payload"]) => events.emit({ directory, payload })
    const syncHistorySessions = async (emitEvents = false) => {
      const historySessions = await shim.listHistorySessions()
      const nextHistoryIDs = new Set<string>()
      let created = 0
      let updated = 0
      let removed = 0

      for (const session of historySessions) {
        const info = historySessionInfo(session)
        nextHistoryIDs.add(info.id)
        historySessionIDs.add(info.id)
        const existing = sessions.get(info.id)
        if (!existing) {
          sessions.set(info.id, info)
          messages.delete(info.id)
          created++
          if (emitEvents) emit({ type: "session.created", properties: { info } })
          continue
        }

        if (existing.time.updated !== info.time.updated || existing.title !== info.title) {
          sessions.set(info.id, info)
          messages.delete(info.id)
          updated++
          if (emitEvents) emit({ type: "session.updated", properties: { info } })
        }
      }

      for (const id of Array.from(historySessionIDs)) {
        if (nextHistoryIDs.has(id)) continue
        const info = sessions.get(id)
        sessions.delete(id)
        messages.delete(id)
        historySessionIDs.delete(id)
        removed++
        if (emitEvents && info) emit({ type: "session.deleted", properties: { info } })
      }

      log.debug("genericagent history synchronized", {
        count: historySessions.length,
        created,
        updated,
        removed,
        emitEvents,
      })
    }

    void syncHistorySessions().catch((e) => {
      log.warn("genericagent history initialization failed", { error: e instanceof Error ? e.message : String(e) })
    })

    const emitStatus = (sessionID: string, type: "busy" | "idle") =>
      emit({ type: "session.status", properties: { sessionID, status: { type } } })

    const serialize = async <T>(sessionID: string, fn: () => Promise<T>): Promise<T> => {
      const prev = sessionLock.get(sessionID) ?? Promise.resolve()
      const next = prev.catch(() => undefined).then(fn)
      sessionLock.set(
        sessionID,
        next.catch(() => undefined),
      )
      return next
    }

    const app = new Hono()
      .onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err)
        log.error("genericagent bridge request failed", { error: message })
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
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input
            if (opts.cors?.includes(input)) return input
            return
          },
          exposeHeaders: ["X-Next-Cursor", "Link"],
        }),
      )
      .get("/global/health", async (c) => {
        const health = await shim.health()
        if (health.ok) return c.json({ healthy: true, version, model: health.model })
        return c.json(new NamedError.Unknown({ message: health.error ?? "shim unavailable" }).toObject(), { status: 503 })
      })
      .get("/global/config", async (c) => {
        const llms = await shim.listLlms()
        return c.json({ model: `${providerID}/${currentModelID(llms)}` })
      })
      .patch("/global/config", async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as { model?: string }
        const requested = typeof body.model === "string" ? body.model : undefined
        if (requested) {
          const slash = requested.indexOf("/")
          const m = slash >= 0 ? requested.slice(slash + 1) : requested
          const idx = parseLlmIndex(m)
          if (idx !== undefined) {
            const result = await shim.selectLlm(idx)
            if (!result.ok) log.warn("selectLlm failed via /global/config", { index: idx, error: result.error })
          }
        }
        const llms = await shim.listLlms()
        return c.json({ model: `${providerID}/${currentModelID(llms)}` })
      })
      .post("/global/dispose", (c) => {
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
            name: "GenericAgent",
            time: { created: Date.now(), updated: Date.now() },
            sandboxes: [],
          },
        ]),
      )
      .get("/project/current", (c) =>
        c.json({
          id: projectID,
          worktree: directory,
          name: "GenericAgent",
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        }),
      )
      .get("/provider", async (c) => {
        const llms = await shim.listLlms()
        const prov = buildProvider(llms)
        const current = currentModelID(llms)
        return c.json({
          all: [prov],
          default: { [providerID]: `${providerID}/${current}` },
          connected: [providerID],
        })
      })
      .get("/provider/auth", (c) => c.json({}))
      .get("/config", (c) => c.json({}))
      .get("/command", (c) => c.json([]))
      .get("/agent", async (c) => {
        const llms = await shim.listLlms()
        const current = currentModelID(llms)
        return c.json([{ ...agent, model: { providerID, modelID: current } }])
      })
      .get("/skill", (c) => c.json([]))
      .get("/mcp", (c) => c.json({}))
      .get("/lsp", (c) => c.json([]))
      .get("/vcs", (c) => c.json({ branch: "genericagent" }))
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
      .get("/session", async (c) => {
        await syncHistorySessions(true)
        const all = Array.from(sessions.values()).sort((a, b) => b.time.updated - a.time.updated)
        const limitParam = c.req.query("limit")
        const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
        if (limit && limit > 0 && all.length > limit) {
          const page = all.slice(0, limit)
          const lastSession = page[page.length - 1]
          c.header("X-Next-Cursor", String(lastSession.time.updated))
          return c.json(page)
        }
        return c.json(all)
      })
      .post("/session", async (c) => {
        const body = (await c.req.json().catch(() => ({}))) as { id?: string; title?: string; parentID?: string }
        const id = body.id || Identifier.ascending("session")
        const info: SessionInfo = {
          id,
          slug: id,
          projectID,
          directory,
          title: body.title || "New Conversation",
          version,
          time: { created: Date.now(), updated: Date.now() },
        }
        sessions.set(id, info)
        messages.set(id, [])
        if (!body.parentID) {
          await shim.snapshotLog()
          await shim.reset()
        }
        emit({ type: "session.created", properties: { info } })
        return c.json(info)
      })
      .delete("/session/:sessionID", (c) => {
        const sessionID = c.req.param("sessionID")
        const info = sessions.get(sessionID)
        if (info) {
          sessions.delete(sessionID)
          messages.delete(sessionID)
          emit({ type: "session.deleted", properties: { info } })
        }
        return c.json(true)
      })
      .get("/session/:sessionID", (c) => {
        const sessionID = c.req.param("sessionID")
        const info = sessions.get(sessionID)
        if (info) return c.json(info)
        const fallback: SessionInfo = {
          id: sessionID,
          slug: sessionID,
          projectID,
          directory,
          title: sessionID,
          version,
          time: { created: Date.now(), updated: Date.now() },
        }
        return c.json(fallback)
      })
      .get("/session/:sessionID/todo", (c) => c.json([]))
      .get("/session/:sessionID/children", (c) => c.json([]))
      .get("/session/:sessionID/message", async (c) => {
        const sessionID = c.req.param("sessionID")
        const limitParam = c.req.query("limit")
        const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
        const before = c.req.query("before") ?? undefined

        let allMessages: Message[]
        const existing = messages.get(sessionID)
        if (existing) {
          allMessages = existing
        } else {
          const session = sessions.get(sessionID)
          if (!session) {
            return c.json([])
          }
          const history = await shim.getHistoryMessages(sessionID)
          allMessages = historyMessagesToBridge(sessionID, session.time.updated, history)
          messages.set(sessionID, allMessages)
        }

        const sorted = [...allMessages].sort((a, b) => (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0))

        let filtered = sorted
        if (before) {
          const cursor = cursorDecode(before)
          if (cursor) {
            filtered = sorted.filter((m) => m.info.id < cursor.id)
          }
        }

        if (limit && limit > 0 && filtered.length > limit) {
          const page = filtered.slice(0, limit)
          const lastMessage = page[page.length - 1]
          const nextCursor = cursorEncode({ id: lastMessage.info.id, time: lastMessage.info.time.created })
          c.header("X-Next-Cursor", nextCursor)
          const url = new URL(c.req.url)
          url.searchParams.set("limit", String(limit))
          url.searchParams.set("before", nextCursor)
          c.header("Link", `<${url.toString()}>; rel="next"`)
          return c.json(page)
        }

        return c.json(filtered)
      })
      .post("/session/:sessionID/restore", async (c) => {
        const sessionID = c.req.param("sessionID")
        return c.json(await shim.restoreSession(sessionID))
      })
      .post("/session/:sessionID/abort", async (c) => {
        const sessionID = c.req.param("sessionID")
        const t0 = Date.now()
        log.info("abort handler enter", { sessionID, t: t0 })
        const bucket = messages.get(sessionID)
        const last = bucket?.at(-1)
        if (last && last.info.role === "assistant" && typeof last.info.time.completed !== "number") {
          last.info.time.completed = Date.now()
          emit({ type: "message.updated", properties: { info: last.info } })
          log.info("abort handler emit message.updated", { sessionID, messageID: last.info.id })
        } else {
          log.info("abort handler no in-flight assistant", { sessionID, bucketSize: bucket?.length ?? 0 })
        }
        emitStatus(sessionID, "idle")
        log.info("abort handler emit idle", { sessionID, dtMs: Date.now() - t0 })
        await shim.abort(sessionID)
        log.info("abort handler shim.abort returned", { sessionID, totalMs: Date.now() - t0 })
        return c.json(true)
      })
      .post("/session/:sessionID/prompt_async", async (c) => {
        const sessionID = c.req.param("sessionID")
        const body = await c.req.json().catch(() => ({}))
        const query = extractPrompt(body)
        if (!query) {
          return c.json(new NamedError.Unknown({ message: "empty prompt" }).toObject(), { status: 400 })
        }

        const requestedModelID = typeof (body as { modelID?: string }).modelID === "string" ? (body as { modelID: string }).modelID : undefined
        const requestedIndex = parseLlmIndex(requestedModelID)
        if (requestedIndex !== undefined) {
          const llms = await shim.listLlms()
          const current = llms.find((item) => item.current)
          if (current?.index !== requestedIndex) {
            const result = await shim.selectLlm(requestedIndex)
            if (!result.ok) log.warn("selectLlm failed during prompt", { index: requestedIndex, error: result.error })
          }
        }
        const llmsAfter = await shim.listLlms()
        const currentModelID_ = currentModelID(llmsAfter)

        if (!sessions.has(sessionID)) {
          const info: SessionInfo = {
            id: sessionID,
            slug: sessionID,
            projectID,
            directory,
            title: query.slice(0, 60) || sessionID,
            version,
            time: { created: Date.now(), updated: Date.now() },
          }
          sessions.set(sessionID, info)
          messages.set(sessionID, [])
          emit({ type: "session.created", properties: { info } })
        }

        const user = userMessage(sessionID, query, currentModelID_, extractPromptIds(body))
        const assistant = assistantMessage(sessionID, user.info.id, currentModelID_)
        const bucket = messages.get(sessionID) ?? []
        bucket.push(user, assistant)
        messages.set(sessionID, bucket)

        emitStatus(sessionID, "busy")
        emit({ type: "message.updated", properties: { info: assistant.info } })

        void serialize(sessionID, async () => {
          let accumulated = ""
          const toolParts = new Map<string, any>()
          let reply: TextPart | undefined
          const TOOL_CALL_RE = /🛠️\s+(?:Tool:\s*`[^`]+`\s*📥\s*args:|[\w_]+\()/
          const TOOL_CALL_BLOCK_RE = /🛠️\s+(?:Tool:\s*`[^`]+`[\s\S]*?````\n|[\w_]+\([^\n]*\)\n*)/g
          const isToolCallDelta = (text: string) => {
            const trimmed = text.trim()
            if (!trimmed) return false
            return TOOL_CALL_RE.test(trimmed)
          }
          const stripToolCallText = (text: string) =>
            text
              .replace(TOOL_CALL_BLOCK_RE, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
          const makeText = (value = "") => {
            if (reply) return reply
            reply = {
              id: Identifier.ascending("part"),
              messageID: assistant.info.id,
              sessionID,
              type: "text",
              text: value,
            }
            assistant.parts.push(reply)
            log.info("Created text part", { sessionID, partID: reply.id, len: value.length })
            emit({
              type: "message.part.updated",
              properties: { part: reply },
            })
            return reply
          }
          try {
            await shim.prompt(sessionID, query, (event) => {
              if (event.type === "tool_use") {
                log.info("Received tool_use event", { data: event.data })
                const toolData = event.data
                if (toolData.type === "tool_start") {
                  reply = undefined
                  const toolPart = {
                    id: Identifier.ascending("part"),
                    messageID: assistant.info.id,
                    sessionID,
                    type: "tool" as const,
                    tool: toolData.tool,
                    state: {
                      status: "running" as const,
                      input: toolData.input || {},
                    },
                  }
                  toolParts.set(toolData.id, toolPart)
                  assistant.parts.push(toolPart)
                  log.info("Created tool part", { toolPart })
                  emit({
                    type: "message.part.updated",
                    properties: { part: toolPart },
                  })
                } else if (toolData.type === "tool_done") {
                  const toolPart = toolParts.get(toolData.id)
                  log.info("Updating tool part", { toolId: toolData.id, found: !!toolPart })
                  if (toolPart) {
                    const outputStr = typeof toolData.output === "string"
                      ? toolData.output
                      : toolData.output != null
                        ? JSON.stringify(toolData.output, null, 2)
                        : ""
                    toolPart.state = {
                      status: toolData.status === "error" ? ("error" as const) : ("completed" as const),
                      input: toolPart.state.input,
                      output: outputStr,
                      metadata: toolData.metadata || {},
                    }
                    if (toolData.status === "error") {
                      toolPart.state.error = "Tool execution failed"
                    }
                    emit({
                      type: "message.part.updated",
                      properties: { part: toolPart },
                    })
                  }
                }
              } else if (event.type === "delta") {
                accumulated += event.text
                if (!isToolCallDelta(event.text)) {
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
                }
              } else if (event.type === "done") {
                const rawFinal = event.text || accumulated
                const finalText = toolParts.size > 0 ? stripToolCallText(rawFinal) : rawFinal
                if (finalText) {
                  const part = makeText(finalText)
                  part.text = finalText
                  emit({
                    type: "message.part.updated",
                    properties: { part: { ...part, text: finalText } },
                  })
                }
                assistant.info.time.completed = Date.now()
                emit({ type: "message.updated", properties: { info: assistant.info } })
                const existing = sessions.get(sessionID)
                if (existing && existing.title === "New Conversation") {
                  const updated = { ...existing, title: query.slice(0, 60) || existing.title, time: { ...existing.time, updated: Date.now() } }
                  sessions.set(sessionID, updated)
                  emit({ type: "session.updated", properties: { info: updated } })
                }
              } else if (event.type === "error") {
                emit({
                  type: "session.error",
                  properties: {
                    sessionID,
                    error: { name: "UnknownError", data: { message: event.message } },
                  },
                })
              }
            })
          } catch (e) {
            const aborted = e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message))
            if (aborted) {
              log.info("prompt_async aborted (fetch cancelled)", { sessionID })
              if (typeof assistant.info.time.completed !== "number") {
                assistant.info.time.completed = Date.now()
                emit({ type: "message.updated", properties: { info: assistant.info } })
                log.info("prompt_async aborted: emit late message.updated", { sessionID })
              }
            } else {
              const message = e instanceof Error ? e.message : String(e)
              log.error("genericagent prompt failed", { sessionID, error: message })
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
            log.info("prompt_async finally: emit idle", { sessionID })
          }
        })

        return c.body(null, 204)
      })
      .post("/session/:sessionID/message", async (c) => {
        return c.json(new NamedError.Unknown({ message: "Use prompt_async for GenericAgent messaging" }).toObject(), {
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
    const server = opts.port === 0 ? (tryServe(4097) ?? tryServe(0)) : tryServe(opts.port)
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
