// In-process harness for sub-agent tests: the real app layer against two local-server fakes. The parent agent talks
// to `parent`, every sub-agent to `child` (config agent model override), so their scripted queues never interleave.
import path from "path"
import { Effect } from "effect"
import type { CliArgs } from "../../src/cli/args"
import { load } from "../../src/config/config"
import { Mcp, Runtime, SessionStore, type RenderEvent, type RunInput, type RuntimeShape, type SessionStoreShape } from "../../src/contract"
import { headlessAsker } from "../../src/permission/permission"
import { appLayer } from "../../src/runtime/runtime"
import { startLocalServer, type ChatBody, type Toggles } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"

const args: CliArgs = {
  outputFormat: "text",
  mcpConfig: [],
  strictMcpConfig: false,
  allowedTools: [],
  disallowedTools: [],
  continue: false,
  noThinking: false,
}
export const fixture = path.resolve(import.meta.dir, "../fixture/mcp-everything.ts")

// Everything pinned: resolving a model sends no probe chat request that would eat a scripted reply.
const pins = {
  capabilities: {
    usage_in_stream: true, reasoning_field: "reasoning_content", think_tags: false, tools_native: true, prefix_cache: true,
    tokenize: false, accepts: { chat_template_kwargs: false, prompt_cache_key: false, reasoning_effort: false, parallel_tool_calls: false },
  },
}

const BUILD = "---\nmode: primary\ntools: [task]\n---\nYou are the build agent (parent)."

export interface SetupOptions {
  child?: Partial<Toggles>
  config?: Record<string, unknown>
  build?: string
  files?: Record<string, string>
  mcp?: boolean
  /** CLI flags for in-process runs (e.g. permissionMode, allowedTools). */
  args?: Partial<CliArgs>
  /** Extra agent files under .oclite/agents (name → markdown). */
  agents?: Record<string, string>
}

export async function setup(options: SetupOptions = {}) {
  const data = await tmpdir()
  process.env.XDG_DATA_HOME = data.path
  const parent = await startLocalServer({ delta_chars: 200 })
  const child = await startLocalServer({ delta_chars: 200, ...options.child })
  const project = await tmpdir({ git: true, files: options.files })
  const home = await tmpdir()
  const provider = (url: string) => ({ npm: "@ai-sdk/openai-compatible", options: { baseURL: url }, models: { m: {} } })
  const childModel = { model: "kid/m" }
  await project.write(
    ".oclite/config.json",
    JSON.stringify({
      model: "dad/m",
      provider: { dad: provider(parent.url), kid: provider(child.url) },
      servers: { [parent.url]: pins, [child.url]: pins },
      permission: { task: "allow" },
      agent: { explore: childModel, code: childModel, audit: childModel },
      ...(options.mcp ? { mcp: { fixture: { type: "local", command: [process.execPath, fixture] } } } : {}),
      ...options.config,
    }),
  )
  await project.write(".oclite/agents/build.md", options.build ?? BUILD)
  await Promise.all(Object.entries(options.agents ?? {}).map(([name, text]) => project.write(`.oclite/agents/${name}.md`, text)))
  const events: RenderEvent[] = []
  const sink = (event: RenderEvent) => Effect.sync(() => void events.push(event))

  const within = async <A>(body: (runtime: RuntimeShape, store: SessionStoreShape) => Effect.Effect<A, unknown>) => {
    const cfg = await Effect.runPromise(
      load({ ...args, ...options.args }, { cwd: project.path, home: home.path, configDir: path.join(home.path, ".config", "oclite") }),
    )
    const program = Effect.gen(function* () {
      const mcp = yield* Mcp
      if (options.mcp) yield* mcp.connectAll(() => Effect.void)
      return yield* body(yield* Runtime, yield* SessionStore)
    })
    return Effect.runPromise(program.pipe(Effect.provide(appLayer(cfg, headlessAsker, undefined, { retryDelays: [5] }))))
  }

  return {
    parent,
    child,
    project,
    home,
    events,
    sink,
    within,
    /** One parent run to completion; returns its result and the parent's JSONL. */
    run: (prompt: string, input: Partial<RunInput> = {}) =>
      within((runtime, store) =>
        Effect.gen(function* () {
          const handle = yield* runtime.start({ agent: "build", prompt, ...input }, sink)
          const result = yield* handle.await
          return { result, records: yield* store.read(handle.session_id), store }
        }),
      ),
    [Symbol.asyncDispose]: async () => {
      await parent.stop()
      await child.stop()
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
      await data[Symbol.asyncDispose]()
    },
  }
}

export const systemOf = (body: ChatBody | undefined) => String(body?.messages?.find((item) => item.role === "system")?.content ?? "")
export const toolNames = (body: ChatBody | undefined) =>
  (body?.tools ?? []).map((tool) => (tool as { function: { name: string } }).function.name)
/** The envelope a task call returned, from the parent's tool_result record. */
export const taskIds = (text: string) => [...text.matchAll(/<task id="(ses_[A-Za-z0-9]+)"/g)].map((match) => match[1]!)
