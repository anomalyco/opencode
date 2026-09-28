// Subprocess harness for `-p`, REPL and render tests: a project wired to test/lib/local-server.ts, and a spawn that
// timestamps every stdout line and the first stderr byte (constraint 2 measurements).
import os from "os"
import path from "path"
import { isolatedEnv } from "../lib/cli"
import { startLocalServer, type Toggles } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"

const entry = path.resolve(import.meta.dir, "../../src/index.ts")
// Shared across runs so core Ripgrep (glob/grep) downloads its binary at most once per machine when `rg` isn't on PATH.
const cache = path.join(os.tmpdir(), "oclite-test-cache")

export const PINS = {
  usage_in_stream: true,
  reasoning_field: "reasoning_content",
  think_tags: false,
  tools_native: true,
  prefix_cache: true,
  tokenize: false,
  accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
}

export async function setup(input: { toggles?: Partial<Toggles>; pins?: Record<string, unknown>; files?: Record<string, string>; baseURL?: string; apiKey?: string } = {}) {
  const server = await startLocalServer(input.toggles)
  const project = await tmpdir({ git: true, files: input.files })
  const home = await tmpdir()
  const baseURL = input.baseURL ?? server.url
  await project.write(
    ".oclite/config.json",
    JSON.stringify({
      model: "local/test-model",
      provider: { local: { npm: "@ai-sdk/openai-compatible", options: { baseURL, ...(input.apiKey ? { apiKey: input.apiKey } : {}) }, models: { "test-model": { reasoning: true } } } },
      ...(input.baseURL ? {} : { servers: { [server.url]: { capabilities: { ...PINS, ...input.pins } } } }),
    }),
  )
  return {
    server,
    project,
    home,
    spawn: (args: string[], options: { stdin?: string; env?: Record<string, string>; onLine?: (line: string, proc: Bun.Subprocess) => void; onStderr?: (text: string, proc: Bun.Subprocess) => void } = {}) =>
      spawn(args, { cwd: project.path, home: home.path, ...options }),
    [Symbol.asyncDispose]: async () => {
      await server.stop()
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
    },
  }
}

export type Spawned = Awaited<ReturnType<typeof spawn>>

async function spawn(
  args: string[],
  options: { cwd: string; home: string; stdin?: string; env?: Record<string, string>; onLine?: (line: string, proc: Bun.Subprocess) => void; onStderr?: (text: string, proc: Bun.Subprocess) => void },
) {
  const started = Date.now()
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd: options.cwd,
    // The fake provider lives in the project layer, so these runs trust it (as `--trust-project` would); trust tests unset it.
    env: { ...isolatedEnv(options.home), XDG_CACHE_HOME: cache, OCLITE_RETRY_SCALE: "0.001", OCLITE_TRUST_PROJECT: "1", ...options.env },
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const lines: Array<{ at: number; line: string }> = []
  const stdout = (async () => {
    const decoder = new TextDecoder()
    const state = { text: "", tail: "" }
    for await (const chunk of chunks(proc.stdout)) {
      const at = Date.now()
      const text = decoder.decode(chunk, { stream: true })
      state.text += text
      const parts = (state.tail + text).split("\n")
      state.tail = parts.pop() ?? ""
      parts.forEach((line) => {
        lines.push({ at, line })
        options.onLine?.(line, proc)
      })
    }
    return state.text
  })()
  const first = { stderr: 0 }
  const stderr = (async () => {
    const decoder = new TextDecoder()
    const state = { text: "" }
    for await (const chunk of chunks(proc.stderr)) {
      if (!first.stderr) first.stderr = Date.now()
      state.text += decoder.decode(chunk, { stream: true })
      options.onStderr?.(state.text, proc)
    }
    return state.text
  })()
  const [out, err, code] = await Promise.all([stdout, stderr, proc.exited])
  return { code, stdout: out, stderr: err, lines, started, firstStderrMs: first.stderr ? first.stderr - started : undefined }
}

async function* chunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) return
    yield next.value
  }
}
