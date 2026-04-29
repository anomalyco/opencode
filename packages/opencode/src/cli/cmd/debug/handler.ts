import { EOL } from "os"
import { basename } from "path"
import { Effect, Stream } from "effect"
import { Agent } from "../../../agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { MessageV2 } from "../../../session/message-v2"
import { MessageID, PartID } from "../../../session/schema"
import { ToolRegistry } from "@/tool/registry"
import { Instance } from "../../../project/instance"
import { Permission } from "../../../permission"
import { iife } from "../../../util/iife"
import { bootstrap } from "../../bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Config } from "@/config/config"
import { File } from "../../../file"
import { Ripgrep } from "../../../file/ripgrep"
import { LSP } from "@/lsp/lsp"
import * as Log from "@opencode-ai/core/util/log"
import { Project } from "@/project/project"
import { Skill } from "../../../skill"
import { Snapshot } from "../../../snapshot"
import { Global } from "@opencode-ai/core/global"

// config
export async function configHandler() {
  await bootstrap(process.cwd(), async () => {
    const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  })
}

// file
export async function fileSearchHandler(args: { query: string }) {
  await bootstrap(process.cwd(), async () => {
    const results = await AppRuntime.runPromise(File.Service.use((svc) => svc.search({ query: args.query })))
    process.stdout.write(results.join(EOL) + EOL)
  })
}

export async function fileReadHandler(args: { path: string }) {
  await bootstrap(process.cwd(), async () => {
    const content = await AppRuntime.runPromise(File.Service.use((svc) => svc.read(args.path)))
    process.stdout.write(JSON.stringify(content, null, 2) + EOL)
  })
}

export async function fileStatusHandler() {
  await bootstrap(process.cwd(), async () => {
    const status = await AppRuntime.runPromise(File.Service.use((svc) => svc.status()))
    process.stdout.write(JSON.stringify(status, null, 2) + EOL)
  })
}

export async function fileListHandler(args: { path: string }) {
  await bootstrap(process.cwd(), async () => {
    const files = await AppRuntime.runPromise(File.Service.use((svc) => svc.list(args.path)))
    process.stdout.write(JSON.stringify(files, null, 2) + EOL)
  })
}

export async function fileTreeHandler(args: { dir: string }) {
  await bootstrap(process.cwd(), async () => {
    const tree = await AppRuntime.runPromise(Ripgrep.Service.use((svc) => svc.tree({ cwd: args.dir, limit: 200 })))
    console.log(JSON.stringify(tree, null, 2))
  })
}

// lsp
export async function lspDiagnosticsHandler(args: { file: string }) {
  await bootstrap(process.cwd(), async () => {
    const out = await AppRuntime.runPromise(
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          yield* lsp.touchFile(args.file, "full")
          return yield* lsp.diagnostics()
        }),
      ),
    )
    process.stdout.write(JSON.stringify(out, null, 2) + EOL)
  })
}

export async function lspSymbolsHandler(args: { query: string }) {
  await bootstrap(process.cwd(), async () => {
    using _ = Log.Default.time("symbols")
    const results = await AppRuntime.runPromise(LSP.Service.use((lsp) => lsp.workspaceSymbol(args.query)))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  })
}

export async function lspDocumentSymbolsHandler(args: { uri: string }) {
  await bootstrap(process.cwd(), async () => {
    using _ = Log.Default.time("document-symbols")
    const results = await AppRuntime.runPromise(LSP.Service.use((lsp) => lsp.documentSymbol(args.uri)))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  })
}

// ripgrep
export async function rgTreeHandler(args: { limit?: number }) {
  await bootstrap(process.cwd(), async () => {
    const tree = await AppRuntime.runPromise(
      Ripgrep.Service.use((svc) => svc.tree({ cwd: Instance.directory, limit: args.limit })),
    )
    process.stdout.write(tree + EOL)
  })
}

export async function rgFilesHandler(args: { query?: string; glob?: string; limit?: number }) {
  await bootstrap(process.cwd(), async () => {
    const files = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const rg = yield* Ripgrep.Service
        return yield* rg
          .files({
            cwd: Instance.directory,
            glob: args.glob ? [args.glob] : undefined,
          })
          .pipe(
            Stream.take(args.limit ?? Infinity),
            Stream.runCollect,
            Effect.map((c) => [...c]),
          )
      }),
    )
    process.stdout.write(files.join(EOL) + EOL)
  })
}

export async function rgSearchHandler(args: { pattern: string; glob?: unknown; limit?: number }) {
  await bootstrap(process.cwd(), async () => {
    const results = await AppRuntime.runPromise(
      Ripgrep.Service.use((svc) =>
        svc.search({
          cwd: Instance.directory,
          pattern: args.pattern,
          glob: args.glob as string[] | undefined,
          limit: args.limit,
        }),
      ),
    )
    process.stdout.write(JSON.stringify(results.items, null, 2) + EOL)
  })
}

// scrap
export async function scrapHandler() {
  const timer = Log.Default.time("scrap")
  const list = await Project.list()
  process.stdout.write(JSON.stringify(list, null, 2) + EOL)
  timer.stop()
}

// skill
export async function skillHandler() {
  await bootstrap(process.cwd(), async () => {
    const skills = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        return yield* skill.all()
      }),
    )
    process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
  })
}

// snapshot
export async function snapshotTrackHandler() {
  await bootstrap(process.cwd(), async () => {
    console.log(await AppRuntime.runPromise(Snapshot.Service.use((svc) => svc.track())))
  })
}

export async function snapshotPatchHandler(args: { hash: string }) {
  await bootstrap(process.cwd(), async () => {
    console.log(await AppRuntime.runPromise(Snapshot.Service.use((svc) => svc.patch(args.hash))))
  })
}

export async function snapshotDiffHandler(args: { hash: string }) {
  await bootstrap(process.cwd(), async () => {
    console.log(await AppRuntime.runPromise(Snapshot.Service.use((svc) => svc.diff(args.hash))))
  })
}

// agent
export async function agentHandler(args: { name: string; tool?: string; params?: string }) {
  await bootstrap(process.cwd(), async () => {
    const agentName = args.name as string
    const agent = await AppRuntime.runPromise(Agent.Service.use((svc) => svc.get(agentName)))
    if (!agent) {
      process.stderr.write(
        `Agent ${agentName} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
      )
      process.exit(1)
    }
    const availableTools = await getAvailableTools(agent)
    const resolvedTools = await resolveTools(agent, availableTools)
    const toolID = args.tool as string | undefined
    if (toolID) {
      const tool = availableTools.find((item) => item.id === toolID)
      if (!tool) {
        process.stderr.write(`Tool ${toolID} not found for agent ${agentName}` + EOL)
        process.exit(1)
      }
      if (resolvedTools[toolID] === false) {
        process.stderr.write(`Tool ${toolID} is disabled for agent ${agentName}` + EOL)
        process.exit(1)
      }
      const params = parseToolParams(args.params as string | undefined)
      const ctx = await createToolContext(agent)
      const result = await tool.execute(params, ctx)
      process.stdout.write(JSON.stringify({ tool: toolID, input: params, result }, null, 2) + EOL)
      return
    }

    const output = {
      ...agent,
      tools: resolvedTools,
    }
    process.stdout.write(JSON.stringify(output, null, 2) + EOL)
  })
}

async function getAvailableTools(agent: Agent.Info) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      const registry = yield* ToolRegistry.Service
      const model = agent.model ?? (yield* provider.defaultModel())
      return yield* registry.tools({
        ...model,
        agent,
      })
    }),
  )
}

async function resolveTools(agent: Agent.Info, availableTools: Awaited<ReturnType<typeof getAvailableTools>>) {
  const disabled = Permission.disabled(
    availableTools.map((tool) => tool.id),
    agent.permission,
  )
  const resolved: Record<string, boolean> = {}
  for (const tool of availableTools) {
    resolved[tool.id] = !disabled.has(tool.id)
  }
  return resolved
}

function parseToolParams(input?: string) {
  if (!input) return {}
  const trimmed = input.trim()
  if (trimmed.length === 0) return {}

  const parsed = iife(() => {
    try {
      return JSON.parse(trimmed)
    } catch (jsonError) {
      try {
        return new Function(`return (${trimmed})`)()
      } catch (evalError) {
        throw new Error(
          `Failed to parse --params. Use JSON or a JS object literal. JSON error: ${jsonError}. Eval error: ${evalError}.`,
          { cause: evalError },
        )
      }
    }
  })

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool params must be an object.")
  }
  return parsed as Record<string, unknown>
}

async function createToolContext(agent: Agent.Info) {
  const { session, messageID } = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const session = yield* Session.Service
      const result = yield* session.create({ title: `Debug tool run (${agent.name})` })
      const messageID = MessageID.ascending()
      const model = agent.model
        ? agent.model
        : yield* Effect.gen(function* () {
            const provider = yield* Provider.Service
            return yield* provider.defaultModel()
          })
      const now = Date.now()
      const message: MessageV2.Assistant = {
        id: messageID,
        sessionID: result.id,
        role: "assistant",
        time: {
          created: now,
        },
        parentID: messageID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "debug",
        agent: agent.name,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      }
      yield* session.updateMessage(message)
      return { session: result, messageID }
    }),
  )

  const ruleset = Permission.merge(agent.permission, session.permission ?? [])

  return {
    sessionID: session.id,
    messageID,
    callID: PartID.ascending(),
    agent: agent.name,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask(req: Omit<Permission.Request, "id" | "sessionID" | "tool">) {
      return Effect.sync(() => {
        for (const pattern of req.patterns) {
          const rule = Permission.evaluate(req.permission, pattern, ruleset)
          if (rule.action === "deny") {
            throw new Permission.DeniedError({ ruleset })
          }
        }
      })
    },
  }
}

// paths
export function pathsHandler() {
  for (const [key, value] of Object.entries(Global.Path)) {
    console.log(key.padEnd(10), value)
  }
}

// wait
export async function waitHandler() {
  await bootstrap(process.cwd(), async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
  })
}
