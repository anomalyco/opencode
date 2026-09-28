// Shared setup for tools/permission/hooks tests: real layers, an in-memory SessionStore (the contract interface) and
// a scripted Asker standing in for a person at the REPL.
import { afterAll, beforeAll } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { ToolRuntime } from "@opencode-ai/llm"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import {
  type AgentDef,
  AppConfig,
  Asker,
  type AskReply,
  type AskRequest,
  type Capabilities,
  type OcliteTool,
  Permission,
  type PermissionMode,
  type Profile,
  type RenderEvent,
  type ResolvedConfig,
  SessionStore,
  type SessionRecord,
  ToolRegistry,
} from "../../src/contract"
import { layer as hooksLayer } from "../../src/hooks/hooks"
import { headlessAsker, layer as permissionLayer } from "../../src/permission/permission"
import { make as registry, outcome } from "../../src/tools/registry"

export const CAPS: Capabilities = {
  context_window: 32768,
  usage_in_stream: true,
  reasoning_field: "none",
  think_tags: false,
  tools_native: true,
  accepts: {
    chat_template_kwargs: false,
    prompt_cache_key: false,
    reasoning_effort: false,
    parallel_tool_calls: false,
  },
  prefix_cache: true,
  concurrency: 1,
  tokenize: false,
  no_think_suffix: false,
}

export const PROFILE: Profile = {
  name: "default",
  promptMaxChars: undefined,
  tools: ["bash", "edit", "glob", "grep", "read", "skill", "todowrite", "webfetch", "write"],
  optionalTools: [],
  descriptionMaxChars: undefined,
  mcp: "all",
  instructionCapChars: undefined,
  title: false,
  stubAfterTurns: 6,
  compactAt: 0.75,
  budgetTokens: 7300,
}

export function config(cwd: string, overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    cwd,
    projectRoot: cwd,
    model: "test/model",
    default_agent: "build",
    provider: {},
    mcp: {},
    permission: [],
    cliRules: [],
    permissionMode: "default",
    instructions: [],
    hooks: { PreToolUse: [], PostToolUse: [], Stop: [] },
    servers: {},
    agents: {},
    permission_timeout_ms: 300_000,
    subagent: { max_depth: 2, max_concurrent: 4 },
    showThinking: true,
    ...overrides,
  }
}

export function agent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    name: "build",
    mode: "primary",
    permission: [],
    options: {},
    source: "builtin",
    transport: "in-process",
    max_depth: 2,
    read_only: false,
    thinking: "auto",
    ...overrides,
  }
}

export function memoryStore(records = new Map<string, SessionRecord[]>()) {
  return Layer.succeed(SessionStore, {
    create: () => Effect.succeed("ses_test"),
    append: (session, record) =>
      Effect.sync(() => {
        const list = records.get(session) ?? []
        records.set(session, [...list, { ...record, seq: list.length, t: Date.now() } as SessionRecord])
      }),
    read: (session) => Effect.sync(() => records.get(session) ?? []),
    list: () => Effect.succeed([]),
    latest: () => Effect.succeed(undefined),
  })
}

/** Replies in order (then rejects); every request is kept for assertions. */
export function scriptedAsker(replies: AskReply[], seen: AskRequest[] = []) {
  return Layer.succeed(Asker, {
    ask: (request) =>
      Effect.sync(() => {
        seen.push(request)
        return replies.shift() ?? "reject"
      }),
  })
}

export function permissionLayers(
  cfg: ResolvedConfig,
  input: { asker?: Layer.Layer<Asker>; records?: Map<string, SessionRecord[]> } = {},
) {
  return permissionLayer.pipe(
    Layer.provide(
      Layer.mergeAll(Layer.succeed(AppConfig, cfg), input.asker ?? headlessAsker, memoryStore(input.records)),
    ),
  )
}

/** A run's tool set on the real registry, permission and hooks layers. */
export async function toolset(
  cfg: ResolvedConfig,
  input: {
    agent?: AgentDef
    mode?: PermissionMode
    asker?: Layer.Layer<Asker>
    records?: Map<string, SessionRecord[]>
    extra?: OcliteTool[]
    caps?: Capabilities
    profile?: Profile
    events?: RenderEvent[]
    describe?: (profile: Profile, tool: string) => string | undefined
    mcpReadOnly?: string[]
  } = {},
) {
  const deps = Layer.mergeAll(
    permissionLayers(cfg, input),
    hooksLayer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg))),
    Layer.succeed(AppConfig, cfg),
  )
  const layer = Layer.merge(registry({ describe: input.describe ?? (() => undefined) }).pipe(Layer.provide(deps)), deps)
  const events = input.events ?? []
  const built = await Effect.runPromise(
    Effect.gen(function* () {
      const permission = yield* Permission
      const registry = yield* ToolRegistry
      const def = input.agent ?? agent()
      const ruleset: PermissionV1.Ruleset = permission.ruleset({
        agent: def,
        mode: input.mode ?? "default",
        mcpReadOnly: input.mcpReadOnly ?? [],
      })
      const set = yield* registry.build(
        {
          session_id: "ses_test",
          cwd: cfg.cwd,
          agent: def,
          depth: 0,
          ruleset,
          sink: (event) => Effect.sync(() => void events.push(event)),
          profile: input.profile ?? PROFILE,
        },
        input.extra ?? [],
        input.caps ?? CAPS,
      )
      return { set, permission }
    }).pipe(Effect.provide(layer)),
  )
  return {
    ...built,
    events,
    call: (name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2)}`) =>
      Effect.runPromise(
        ToolRuntime.dispatch(built.set.tools, { type: "tool-call", id, name, input: args }).pipe(Effect.map(outcome)),
      ),
    denials: () => Effect.runPromise(built.permission.denials("ses_test")),
  }
}

/** Points XDG_DATA_HOME at a temp dir for the file's tests, so overflow files stay out of ~/.local/share. */
export function tempDataHome() {
  const previous = process.env.XDG_DATA_HOME
  const data = path.join(os.tmpdir(), `oclite-data-${process.pid}-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => {
    process.env.XDG_DATA_HOME = data
  })
  afterAll(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    if (previous !== undefined) process.env.XDG_DATA_HOME = previous
    await fs.rm(data, { recursive: true, force: true })
  })
  return data
}
