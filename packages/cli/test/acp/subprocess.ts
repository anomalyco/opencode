import type {
  InitializeResponse,
  NewSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type JsonRpcRequest = {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

export type JsonRpcError = {
  readonly code: number
  readonly message?: string
  readonly data?: unknown
}

export type JsonRpcResponse<T> = {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly result?: T
  readonly error?: JsonRpcError
}

type JsonRpcNotification<T> = {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params: T
}

type JsonRpcMessage = Record<string, unknown>

type Waiter = {
  readonly predicate: (message: JsonRpcMessage) => boolean
  readonly resolve: (message: JsonRpcMessage) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export type AcpProcess = {
  readonly request: <T>(method: string, params?: unknown) => Promise<JsonRpcResponse<T>>
  readonly waitForNotification: <T>(
    method: string,
    predicate: (params: T) => boolean,
    timeoutMs?: number,
  ) => Promise<JsonRpcNotification<T>>
  readonly close: () => Promise<number>
  readonly stderr: () => string
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export const verifierSkill = `---
name: verifier-skill
description: Verifier compatibility skill.
---

# Verifier Skill
`

export async function createAcpFixture(options: { readonly skill?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cli-acp-"))
  const home = path.join(root, "workspace")
  const config = path.join(root, "config")
  const skills = path.join(root, "skills")
  await Promise.all([fs.mkdir(home, { recursive: true }), fs.mkdir(config, { recursive: true })])
  if (options.skill) {
    await fs.mkdir(path.join(skills, "verifier-skill"), { recursive: true })
    await Bun.write(path.join(skills, "verifier-skill", "SKILL.md"), options.skill)
  }

  const requests: unknown[] = []
  const llm = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response("Not found", { status: 404 })
      }
      requests.push(await request.json().catch(() => undefined))
      return new Response(completion("accepted"), {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  await Bun.write(
    path.join(config, "opencode.json"),
    JSON.stringify(verifierConfig(`http://127.0.0.1:${llm.port}/v1`, options.skill ? skills : undefined)),
  )

  const processes = new Set<AcpProcess>()
  return {
    root,
    home,
    llm: { requests },
    spawn(extraEnv: Record<string, string | undefined> = {}) {
      const acp = spawnAcp({
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          OPENCODE_CONFIG: undefined,
          OPENCODE_CONFIG_CONTENT: undefined,
          OPENCODE_CONFIG_DIR: config,
          OPENCODE_DB: path.join(root, "opencode.db"),
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          OPENCODE_DISABLE_FILEWATCHER: "true",
          OPENCODE_DISABLE_MODELS_FETCH: "true",
          OPENCODE_MODELS_PATH: undefined,
          OPENCODE_TEST_HOME: root,
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_CONFIG_HOME: path.join(root, "xdg-config"),
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_STATE_HOME: path.join(root, "state"),
          ...extraEnv,
        },
      })
      processes.add(acp)
      return acp
    },
    async [Symbol.asyncDispose]() {
      await Promise.all([...processes].map((process) => process[Symbol.asyncDispose]()))
      await llm.stop(true)
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

export function initialize(acp: AcpProcess) {
  return acp
    .request<InitializeResponse>("initialize", {
      protocolVersion: 1,
      clientCapabilities: { _meta: { "terminal-auth": true } },
      clientInfo: { name: "opencode-local-acp", version: "0.1.0" },
    })
    .then(expectOk)
}

export function newSession(acp: AcpProcess, cwd: string) {
  return acp.request<NewSessionResponse>("session/new", { cwd, mcpServers: [] }).then(expectOk)
}

export function expectOk<T>(response: JsonRpcResponse<T>) {
  if (response.error) throw new Error(`ACP request failed: ${JSON.stringify(response.error)}`)
  if (response.result === undefined) throw new Error("ACP response did not include a result")
  return response.result
}

export function selectConfigOption(options: SessionConfigOption[] | null | undefined, id: string) {
  return options?.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.id === id && option.type === "select",
  )
}

export function requireSelectOption(options: SessionConfigOption[] | null | undefined, id: string) {
  const option = selectConfigOption(options, id)
  if (!option) throw new Error(`Missing ACP config option: ${id}`)
  return option
}

export function flattenSelectOptions(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((item): SessionConfigSelectOption[] => ("value" in item ? [item] : item.options))
}

export function alternateValue(option: Extract<SessionConfigOption, { type: "select" }>) {
  const value = flattenSelectOptions(option).find((item) => item.value !== option.currentValue)?.value
  if (!value) throw new Error(`ACP config option ${option.id} has no alternate value`)
  return value
}

function verifierConfig(llmUrl: string, skills?: string) {
  const model = {
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    cost: { input: 0, output: 0 },
    limit: { context: 100_000, output: 10_000 },
  }
  return {
    autoupdate: false,
    model: "test/test-model",
    ...(skills ? { skills: [skills] } : {}),
    providers: {
      test: {
        name: "Test",
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { apiKey: "test-key", baseURL: llmUrl },
        models: {
          "test-model": {
            ...model,
            name: "Test Model",
            variants: [{ id: "low" }, { id: "high" }],
          },
          "second-model": {
            ...model,
            name: "Second Test Model",
            variants: [{ id: "medium" }, { id: "max" }],
          },
        },
      },
    },
  }
}

function spawnAcp(input: { readonly env: Record<string, string | undefined> }): AcpProcess {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "acp"], {
    cwd: path.join(import.meta.dir, "../.."),
    env: input.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const errorDecoder = new TextDecoder()
  const messages: JsonRpcMessage[] = []
  const waiters: Waiter[] = []
  let nextID = 1
  let failure: Error | undefined
  let stderr = ""
  let inputClosed = false
  let disposed = false

  const fail = (error: Error) => {
    if (failure) return
    failure = error
    waiters.splice(0).forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    })
  }

  const dispatch = (message: JsonRpcMessage) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(message))
    if (index === -1) {
      messages.push(message)
      return
    }
    const waiter = waiters.splice(index, 1)[0]
    clearTimeout(waiter.timer)
    waiter.resolve(message)
  }

  const output = (async () => {
    const reader = child.stdout.getReader()
    let buffered = ""
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffered += decoder.decode(chunk.value, { stream: true })
      while (true) {
        const newline = buffered.indexOf("\n")
        if (newline === -1) break
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line) dispatch(parseMessage(line))
      }
    }
    buffered += decoder.decode()
    if (buffered.trim()) dispatch(parseMessage(buffered.trim()))
    fail(new Error(`ACP exited before another response${stderr ? `: ${stderr}` : ""}`))
  })().catch((error) => fail(asError(error)))

  const errors = (async () => {
    const reader = child.stderr.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      stderr += errorDecoder.decode(chunk.value, { stream: true })
    }
    stderr += errorDecoder.decode()
  })()

  const take = (predicate: (message: JsonRpcMessage) => boolean, timeoutMs: number, description: string) => {
    const index = messages.findIndex(predicate)
    if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0])
    if (failure) return Promise.reject(failure)
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) waiters.splice(index, 1)
          reject(new Error(`Timed out waiting for ${description}${stderr ? `: ${stderr}` : ""}`))
        }, timeoutMs),
      }
      waiters.push(waiter)
    })
  }

  return {
    async request<T>(method: string, params?: unknown) {
      if (inputClosed) throw new Error("ACP stdin is closed")
      const id = nextID++
      const request: JsonRpcRequest =
        params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params }
      await child.stdin.write(encoder.encode(`${JSON.stringify(request)}\n`))
      await child.stdin.flush()
      const response = await take((message) => isResponse(message) && message.id === id, 20_000, `${method} response`)
      if (!isResponse<T>(response)) throw new Error(`Invalid ACP response: ${JSON.stringify(response)}`)
      return response
    },
    async waitForNotification<T>(method: string, predicate: (params: T) => boolean, timeoutMs = 20_000) {
      const notification = await take(
        (message) => isNotification<T>(message) && message.method === method && predicate(message.params),
        timeoutMs,
        `${method} notification`,
      )
      if (!isNotification<T>(notification)) {
        throw new Error(`Invalid ACP notification: ${JSON.stringify(notification)}`)
      }
      return notification
    },
    async close() {
      if (!inputClosed) {
        inputClosed = true
        await child.stdin.end()
      }
      const exitCode = await withTimeout(child.exited, 5_000, "ACP did not exit after stdin EOF")
      await Promise.all([output, errors])
      if (exitCode !== 0) throw new Error(`ACP exited with ${exitCode}: ${stderr}`)
      return exitCode
    },
    stderr: () => stderr,
    async [Symbol.asyncDispose]() {
      if (disposed) return
      disposed = true
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
      await Promise.all([output, errors])
    },
  }
}

function parseMessage(line: string): JsonRpcMessage {
  const message: unknown = JSON.parse(line)
  if (!isJsonRpcMessage(message)) throw new Error(`Invalid ACP message: ${line}`)
  return message
}

function isJsonRpcMessage(message: unknown): message is JsonRpcMessage {
  return !!message && typeof message === "object" && !Array.isArray(message)
}

function isResponse<T>(message: JsonRpcMessage): message is JsonRpcMessage & JsonRpcResponse<T> {
  return message.jsonrpc === "2.0" && typeof message.id === "number" && !("method" in message)
}

function isNotification<T>(message: JsonRpcMessage): message is JsonRpcMessage & JsonRpcNotification<T> {
  return message.jsonrpc === "2.0" && typeof message.method === "string" && !("id" in message)
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function completion(text: string) {
  const chunks = [
    { choices: [{ delta: { role: "assistant" }, finish_reason: null }], usage: null },
    { choices: [{ delta: { content: text }, finish_reason: null }], usage: null },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
    {
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    },
  ]
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
}
