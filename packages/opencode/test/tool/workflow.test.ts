import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { afterEach, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import type { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { WorkflowTool, workflowDescription, WORKFLOW_GATE_DEFAULT, WORKFLOW_GATE_ULTRACODE } from "@/tool/workflow"
import AUTHORING_GUIDE from "@/tool/workflow.txt"
import { Workflow } from "@/workflow/workflow"
import { Session } from "@/session/session"
import { TurnBudget } from "@/session/turn-budget"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { MessageID, SessionID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { SessionPrompt } from "@/session/prompt"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID } from "@/session/schema"

// Session.defaultLayer is merged so a test can create a REAL caller session and
// drive ctx.sessionID with its id. Effect layer memoization shares the single
// Session service the ToolRegistry already builds internally, so a session
// created here is the same one the workflow tool's background completion path
// reads via `sessions.get(ctx.sessionID)` before delivering its message.
// Workflow.defaultLayer is merged so a test can read the engine's run state via
// `Workflow.Service` (e.g. asserting a started run carries resume_of). Effect
// layer memoization shares the single Workflow service the ToolRegistry already
// builds internally, so a run started through the tool is the same run this
// service reads back — mirroring why Session.defaultLayer is merged here.
const it = testEffect(
  Layer.mergeAll(
    ToolRegistry.defaultLayer,
    Session.defaultLayer,
    Workflow.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ).pipe(Layer.provide(Ripgrep.defaultLayer)),
)

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  extra: {
    promptOps: {
      prompt: () => Effect.succeed({ parts: [] } as never),
    },
  },
}

async function writeWorkflow(dir: string, name: string, source: string) {
  const workflows = path.join(dir, ".opencode", "workflows")
  await fs.mkdir(workflows, { recursive: true })
  await Bun.write(path.join(workflows, `${name}.ts`), source)
}

async function writePluginFile(dir: string, fileName: string, workflows: Record<string, string>) {
  const file = path.join(dir, fileName)
  await Bun.write(
    file,
    `export default async function Plugin() {
  return {
    workflow: ${JSON.stringify(workflows, null, 6)}
  }
}
`,
  )
  return pathToFileURL(file).href
}

async function writePlugin(dir: string, workflows: Record<string, string>) {
  const spec = await writePluginFile(dir, "workflow-plugin.ts", workflows)
  await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [spec] }))
}

function pluginWorkflowSource(name: string, marker: string) {
  return `export default {
  meta: { name: ${JSON.stringify(name)}, description: ${JSON.stringify(marker)} },
  async run(args, ctx) {
    ctx.log(${JSON.stringify(`${marker} ran`)})
    return { marker: ${JSON.stringify(marker)}, value: args.value ?? null }
  }
}`
}

// Item 18: temporary starts persist their script under the GLOBAL data dir
// (survives the tmpdir instance); sweep the per-run directory so test runs do
// not accumulate artifacts there.
function cleanupPersistedScript(runId: string) {
  return Effect.promise(() => fs.rm(path.join(Global.Path.data, "workflow", runId), { recursive: true, force: true }))
}

function requestRecorder() {
  const requests: Parameters<Tool.Context["ask"]>[0][] = []
  const prompts: SessionPrompt.PromptInput[] = []
  const ctx: Tool.Context = {
    ...baseCtx,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req)
      }),
    extra: {
      promptOps: {
        prompt: (input: SessionPrompt.PromptInput) =>
          Effect.sync(() => {
            prompts.push(input)
            return {
              info: {
                id: MessageID.ascending(),
                role: "assistant",
                parentID: input.messageID ?? MessageID.ascending(),
                sessionID: input.sessionID,
                mode: input.agent ?? "general",
                agent: input.agent ?? "general",
                cost: 0,
                path: { cwd: "/tmp", root: "/tmp" },
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                modelID: input.model?.modelID ?? ModelV2.ID.make("gpt-5"),
                providerID: input.model?.providerID ?? ProviderV2.ID.opencode,
                time: { created: Date.now() },
                finish: "stop",
              },
              parts: [
                {
                  id: PartID.ascending(),
                  messageID: MessageID.ascending(),
                  sessionID: input.sessionID,
                  type: "text",
                  text: "ok",
                },
              ],
            } as SessionV1.WithParts
          }),
      },
    },
  }
  return { ctx, requests, prompts }
}

function workflowTool() {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const tool = (yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make("gpt-5"),
      agent: { name: "build", mode: "primary", permission: [], options: {} },
    })).find((tool) => tool.id === WorkflowTool.id)
    if (!tool) return yield* Effect.fail(new Error(`Tool not found: ${WorkflowTool.id}`))
    return tool
  })
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.workflow", () => {
  it.live("reads workflow metadata without source", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = {
  name: "Hello",
  description: "Say hello.",
  phases: ["run"],
  arguments: { value: { type: "number", description: "Value to echo." } }
}
export async function run(args, ctx) { ctx.setPhase("run"); return { value: args.value } }
`,
          ),
        )

        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "read", name: "hello" }, requestRecorder().ctx)
        expect(result.output).toContain(`<workflow name="hello">`)
        expect(result.output).toContain("Say hello.")
        expect(result.output).toContain(`<argument name="value" type="number">Value to echo.</argument>`)
        expect(result.output).not.toContain("export async function run")
      }),
    ),
  )

  // Item 1: read WITHOUT a name is the authoring-guide path — guide text plus
  // the startable workflows and the dispatchable agent roster, instead of the
  // old hard "name is required" failure.
  it.live("read without name returns the authoring guide with workflow list and agent roster", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello", description: "Say hello." }
export async function run() { return "ok" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "read" }, requestRecorder().ctx)
        expect(result.title).toBe("Workflow authoring guide")
        // Pipeline-first doctrine anchor (the literal smell-test sentence).
        expect(result.output).toContain("you did not need the barrier")
        expect(result.output).toContain("<available_agents>")
        // The discovered workflow shows up in the appended list.
        expect(result.output).toContain("<available_workflows>")
        expect(result.output).toContain("<name>hello</name>")
      }),
    ),
  )

  it.live("read without name in a project without own workflows still returns the guide", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "read" }, requestRecorder().ctx)
        expect(result.output).toContain("WORKFLOW AUTHORING GUIDE")
        // Builtin workflows may exist even in an empty project, so the list block
        // is either populated or the explicit empty marker — never absent.
        expect(
          result.output.includes("<available_workflows>") ||
            result.output.includes("No workflows are currently available."),
        ).toBe(true)
        expect(result.output).toContain("<available_agents>")
      }),
    ),
  )

  // Item 1 canary against guide drift: the guide must keep describing every ctx
  // primitive of the REAL authoring API plus the load-bearing idioms. A rename or
  // dropped section fails here before it misleads a model.
  it.live("authoring guide documents every ctx primitive and the core idioms (canary)", () =>
    Effect.sync(() => {
      for (const anchor of [
        "ctx.agent",
        "ctx.parallel",
        "ctx.pipeline",
        "ctx.shell",
        "ctx.question",
        "ctx.setPhase",
        "ctx.log",
        "ctx.workflow",
        "ctx.budget",
        "ctx.tool",
        "filter((x) => x !== null)",
        "run(args, ctx)",
      ]) {
        expect(AUTHORING_GUIDE).toContain(anchor)
      }
    }),
  )

  // Item 1: a failed meta validation on create points the author at the guide.
  it.live("create with invalid meta points to the authoring guide", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        // Non-literal meta name → MetaReader rejects it statically after the write.
        const source = `export const meta = { name: someVar }
export async function run() {}
`
        const exit = yield* Effect.exit(tool.execute({ action: "create", name: "badmeta", source }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("authoring guide")
      }),
    ),
  )

  it.live("read renders whenToUse from meta (QW4)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "deploy",
            `export const meta = {
  name: "Deploy",
  description: "Deploy the app.",
  whenToUse: "When the user asks to ship to production."
}
export async function run(args, ctx) { return { ok: true } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "read", name: "deploy" }, requestRecorder().ctx)
        expect(result.output).toContain("<when_to_use>When the user asks to ship to production.</when_to_use>")
      }),
    ),
  )

  it.live("read output includes the live agent roster (QW7)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello", description: "Say hi." }
export async function run(args, ctx) { return { ok: true } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "read", name: "hello" }, requestRecorder().ctx)
        // The roster block exists and lists at least the always-present "general"
        // subagent the engine can dispatch (agent.ts default subagents).
        expect(result.output).toContain("<available_agents>")
        expect(result.output).toContain(`<agent name="general"`)
      }),
    ),
  )

  it.live("starts workflow and asks reusable workflow permission", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello", description: "Echo a value." }
export async function run(args, ctx) { ctx.setPhase("run"); ctx.log("running"); return { value: args.value } }
`,
          ),
        )

        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const result = yield* tool.execute({ action: "start", name: "hello", args: { value: 42 } }, recorder.ctx)

        expect(recorder.requests.length).toBe(1)
        expect(recorder.requests[0].permission).toBe("workflow")
        expect(recorder.requests[0].patterns).toEqual(["hello"])
        expect(recorder.requests[0].always).toEqual(["hello"])
        expect(result.output).toContain(`<workflow_run id="${result.metadata.runId}" state="completed">`)
        expect(result.output).toContain('"value": 42')
      }),
    ),
  )

  it.live("plugin workflow appears in discovery", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writePlugin(dir, { "plugin-list": pluginWorkflowSource("plugin-list", "from plugin") }))

        const workflow = yield* Workflow.Service
        const info = (yield* workflow.list()).find((item) => item.name === "plugin-list")

        expect(info?.valid).toBe(true)
        expect(info?.path).toBe("plugin:plugin-list")
        expect(info?.meta.description).toBe("from plugin")
      }),
    ),
    15000,
  )

  it.live("first loaded plugin wins duplicate workflow names", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          const first = await writePluginFile(dir, "workflow-plugin-first.ts", {
            duplicate: pluginWorkflowSource("duplicate", "from first plugin"),
          })
          const second = await writePluginFile(dir, "workflow-plugin-second.ts", {
            duplicate: pluginWorkflowSource("duplicate", "from second plugin"),
          })
          await Bun.write(
            path.join(dir, "opencode.json"),
            JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [first, second] }),
          )
        })

        const workflow = yield* Workflow.Service
        const info = (yield* workflow.list()).find((item) => item.name === "duplicate")

        expect(info?.valid).toBe(true)
        expect(info?.meta.description).toBe("from first plugin")
      }),
    ),
    15000,
  )

  it.live("project workflow shadows plugin workflow with same name", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await writePlugin(dir, { shadowed: pluginWorkflowSource("shadowed", "from plugin") })
          await writeWorkflow(
            dir,
            "shadowed",
            `export const meta = { name: "shadowed", description: "from project" }
export async function run() { return { marker: "from project" } }
`,
          )
        })

        const workflow = yield* Workflow.Service
        const info = (yield* workflow.list()).find((item) => item.name === "shadowed")

        expect(info?.valid).toBe(true)
        expect(info?.path.endsWith(path.join(".opencode", "workflows", "shadowed.ts"))).toBe(true)
        expect(info?.meta.description).toBe("from project")
      }),
    ),
    15000,
  )

  it.live("global workflow shadows plugin workflow with same name", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const name = `global-plugin-shadow-${Date.now()}`
        const globalFile = path.join(Global.Path.config, "workflows", `${name}.ts`)
        yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(globalFile, { force: true })))
        yield* Effect.promise(async () => {
          await writePlugin(dir, { [name]: pluginWorkflowSource(name, "from plugin") })
          await fs.mkdir(path.dirname(globalFile), { recursive: true })
          await Bun.write(
            globalFile,
            `export const meta = { name: ${JSON.stringify(name)}, description: "from global" }
export async function run() { return { marker: "from global" } }
`,
          )
        })

        const workflow = yield* Workflow.Service
        const info = (yield* workflow.list()).find((item) => item.name === name)

        expect(info?.valid).toBe(true)
        expect(info?.path).toBe(globalFile)
        expect(info?.meta.description).toBe("from global")
      }),
    ),
    15000,
  )

  it.live("plugin workflow shadows built-in workflow with same name", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writePlugin(dir, { "deep-research": pluginWorkflowSource("deep-research", "from plugin") }))

        const workflow = yield* Workflow.Service
        const info = (yield* workflow.list()).find((item) => item.name === "deep-research")

        expect(info?.valid).toBe(true)
        expect(info?.path).toBe("plugin:deep-research")
        expect(info?.source_kind).toBeUndefined()
        expect(info?.meta.description).toBe("from plugin")
      }),
    ),
    15000,
  )

  it.live("starts plugin workflow", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => writePlugin(dir, { "plugin-run": pluginWorkflowSource("plugin-run", "from plugin") }))

        const tool = yield* workflowTool()
        const result = yield* tool.execute(
          { action: "start", name: "plugin-run", args: { value: 42 } },
          requestRecorder().ctx,
        )

        expect(result.output).toContain('"marker": "from plugin"')
        expect(result.output).toContain('"value": 42')
      }),
    ),
    15000,
  )

  it.live("invalid plugin workflow source fails clearly", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writePlugin(dir, {
            "bad-plugin": `export const meta = { name: dynamicName }
export async function run() { return null }
`,
          }),
        )

        const tool = yield* workflowTool()
        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "bad-plugin" }, requestRecorder().ctx))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Invalid workflow plugin:bad-plugin")
      }),
    ),
    15000,
  )

  it.live("workflow ctx.tool calls a native read tool", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "target.txt"), "hello from ctx.tool\n"))
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "toolread",
            `export const meta = { name: "ToolRead", description: "Read via ctx.tool." }
export async function run(args, ctx) {
  const result = await ctx.tool("read", { filePath: "target.txt" })
  return { hasContent: result.output.includes("hello from ctx.tool"), truncated: result.metadata?.truncated }
}
`,
          ),
        )

        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "start", name: "toolread" }, requestRecorder().ctx)
        const workflow = yield* Workflow.Service
        const run = yield* workflow.get(Workflow.RunID.make(result.metadata.runId as string))

        expect(result.output).toContain('"hasContent": true')
        expect(result.output).toContain('"truncated": false')
        expect(run?.logs.some((entry) => entry.message === "tool read completed")).toBe(true)
      }),
    ),
  )

  it.live("workflow ctx.tool onError null resolves null", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "toolnullable",
            `export const meta = { name: "ToolNullable", description: "Null failed tool." }
export async function run(args, ctx) {
  const result = await ctx.tool("missing_tool", {}, { onError: "null" })
  return { isNull: result === null }
}
`,
          ),
        )

        const tool = yield* workflowTool()
        const result = yield* tool.execute({ action: "start", name: "toolnullable" }, requestRecorder().ctx)

        expect(result.output).toContain('"isNull": true')
      }),
    ),
  )

  it.live("workflow ctx.tool invalid name fails clearly", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "toolmissing",
            `export const meta = { name: "ToolMissing", description: "Missing tool." }
export async function run(args, ctx) {
  await ctx.tool("missing_tool")
}
`,
          ),
        )

        const tool = yield* workflowTool()
        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "toolmissing" }, requestRecorder().ctx))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("ctx.tool unknown tool: missing_tool")
      }),
    ),
  )

  it.live("start forwards resume_of + invalidate_agents + replay to workflow.start", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // The workflow hangs when args.hang is set so we can deterministically catch
        // the source run `running` and PAUSE it (the engine only resumes paused or
        // interrupted runs, never completed ones); without the flag it returns
        // synchronously so the resumed run settles on its own.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "echo",
            `export const meta = { name: "Echo", description: "Echo." }
export async function run(args, ctx) { if (args.hang) await new Promise(() => {}); return { value: args.value } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const workflow = yield* Workflow.Service
        // Start a hanging source run in the background, then pause it so it parks as
        // a resumable `paused` source.
        const first = yield* tool.execute(
          { action: "start", name: "echo", args: { value: 1, hang: true }, background: true },
          recorder.ctx,
        )
        const sourceId = first.metadata.runId as string
        const paused = yield* pollWithTimeout(
          workflow
            .pause(Workflow.RunID.make(sourceId))
            .pipe(Effect.map((run) => (run?.status === "paused" ? run : undefined))),
          "source run never paused",
        )
        expect(paused.status).toBe("paused")

        // Resume start: pass resume_of + invalidate_agents + replay (Item 20).
        // The engine replays the (directory-scoped) source journal; what we assert
        // is the parameters reached workflow.start (the new run carries resume_of,
        // the replay literal decodes through the tool schema) and the run still
        // completes.
        const resumed = yield* tool.execute(
          {
            action: "start",
            name: "echo",
            args: { value: 1 },
            resume_of: sourceId,
            invalidate_agents: [0],
            replay: "keyed",
          },
          recorder.ctx,
        )
        const run = yield* workflow.get(Workflow.RunID.make(resumed.metadata.runId as string))
        expect(run?.resume_of as string | undefined).toBe(sourceId)
        expect(resumed.output).toContain(`state="completed"`)
      }),
    ),
  )

  // Item 24: the shared turn pool rides ctx.extra.turnBudget (SessionTools) and
  // must reach workflow.start as StartOptions.pool. Proven end-to-end: the
  // engine settles the run's one agent step against THIS pool object, and an
  // exhausted pool refuses the next run's first step.
  it.live("start threads ctx.extra.turnBudget into the engine as the run's pool", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "agentic",
            `export const meta = { name: "Agentic", description: "One step." }
export async function run(args, ctx) { const r = await ctx.agent({ prompt: "do it" }); return { out: r.text } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const pool = TurnBudget.make({ usd: 1 })
        const ctx: Tool.Context = { ...recorder.ctx, extra: { ...recorder.ctx.extra, turnBudget: pool } }

        const result = yield* tool.execute({ action: "start", name: "agentic" }, ctx)
        expect(result.output).toContain(`state="completed"`)
        // The engine settled the step against THIS pool object.
        expect(pool.steps).toBe(1)
        expect(pool.usd!.reserved).toBe(0)

        // Exhaust the pool: the next run's FIRST agent step is refused — the
        // pool reference demonstrably reached workflow.start.
        TurnBudget.chargeDirect(pool, { usd: 5 })
        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "agentic" }, ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Turn budget exhausted")
      }),
    ),
  )

  it.live("start with inline source runs as a temporary run and asks permission by meta name (P3)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Inline", description: "Inline run." }
export async function run(args, ctx) { return { value: args.value } }
`
        const result = yield* tool.execute({ action: "start", source, args: { value: 9 } }, recorder.ctx)
        // Permission ask used the meta name from the inline source.
        expect(recorder.requests.length).toBe(1)
        expect(recorder.requests[0].permission).toBe("workflow")
        expect(recorder.requests[0].patterns).toEqual(["Inline"])
        // Item 9: the ask metadata carries the display fields for the approval UI.
        expect(recorder.requests[0].metadata).toMatchObject({
          display_name: "Inline",
          description: "Inline run.",
          action: "start",
        })
        expect(result.output).toContain(`state="completed"`)
        expect(result.output).toContain('"value": 9')
        // The run is flagged temporary in its definition.
        expect(result.output).toContain("<temporary>true</temporary>")
      }),
    ),
  )

  it.live("start with invalid inline source fails statically before the permission ask (P3)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        // Non-literal meta name → MetaReader rejects it statically.
        const source = `export const meta = { name: someVar }
export async function run() {}
`
        const exit = yield* Effect.exit(tool.execute({ action: "start", source }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        // No permission ask fired — the static gate ran first.
        expect(recorder.requests.length).toBe(0)
      }),
    ),
  )

  it.live("start rejects both name and source supplied together (P3)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(
          tool.execute({ action: "start", name: "x", source: 'export const meta = { name: "X" }' }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(recorder.requests.length).toBe(0)
      }),
    ),
  )

  // Item 18: every inline start leaves an editable, durable script copy under
  // Global.Path.data/workflow/<runId>/script.ts; the result advertises it both
  // in metadata.scriptPath and as a <script_path> output line.
  it.live("inline start persists the script and returns its path", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Inline", description: "Inline run." }
export async function run(args, ctx) { return { value: args.value } }
`
        const result = yield* tool.execute({ action: "start", source, args: { value: 9 } }, recorder.ctx)
        const runId = result.metadata.runId as string
        const scriptPath = result.metadata.scriptPath as string
        expect(scriptPath).toBe(path.join(Global.Path.data, "workflow", runId, "script.ts"))
        const persisted = yield* Effect.promise(() => fs.readFile(scriptPath, "utf8"))
        expect(persisted).toBe(source)
        expect(result.output).toContain(`<script_path>${scriptPath}</script_path>`)
        yield* cleanupPersistedScript(runId)
      }),
    ),
  )

  // Item 18: script_path starts the file's source as a temporary run; the
  // permission ask keys on the script's meta name (same N15 shape as inline) and
  // carries the resolved path for the approval display.
  it.live("script_path starts a temporary run from a file", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "scratch", "wf.ts")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await Bun.write(
            file,
            `export const meta = { name: "Scripted", description: "From a file." }
export async function run(args, ctx) { return { ok: true } }
`,
          )
        })
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        // Project-RELATIVE path: resolved against the project root, like create.
        const result = yield* tool.execute(
          { action: "start", script_path: path.join("scratch", "wf.ts") },
          recorder.ctx,
        )
        const workflowAsk = recorder.requests.find((req) => req.permission === "workflow")
        expect(workflowAsk).toBeDefined()
        expect(workflowAsk!.patterns).toEqual(["Scripted"])
        expect(workflowAsk!.metadata?.path).toBe(file)
        // An in-project script never trips the external_directory gate.
        expect(recorder.requests.some((req) => req.permission === "external_directory")).toBe(false)
        expect(result.output).toContain('state="completed"')
        expect(result.output).toContain("<temporary>true</temporary>")
        yield* cleanupPersistedScript(result.metadata.runId as string)
      }),
    ),
  )

  // Item 18: exactly ONE of name | source | script_path selects the workflow.
  it.live("script_path is mutually exclusive with name and source", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const combos: Array<Record<string, unknown>> = [
          { action: "start", name: "x", script_path: "y.ts" },
          { action: "start", source: 'export const meta = { name: "X" }', script_path: "y.ts" },
        ]
        for (const combo of combos) {
          const exit = yield* Effect.exit(tool.execute(combo as never, recorder.ctx))
          expect(Exit.isFailure(exit)).toBe(true)
          expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
            "Provide exactly one of name, source, or script_path for action=start",
          )
        }
        expect(recorder.requests.length).toBe(0)
      }),
    ),
  )

  // Item 18: a script outside the project runs through the external_directory
  // permission BEFORE anything is read — the same gate create applies to writes.
  it.live("script_path outside the project goes through the external_directory gate", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const outsideDir = path.join(os.tmpdir(), `oc-wf-ext-${Math.random().toString(16).slice(2)}`)
        const outside = path.join(outsideDir, "wf.ts")
        yield* Effect.promise(async () => {
          await fs.mkdir(outsideDir, { recursive: true })
          await Bun.write(
            outside,
            `export const meta = { name: "Outside" }
export async function run() { return "ok" }
`,
          )
        })
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const result = yield* tool.execute({ action: "start", script_path: outside }, recorder.ctx)
        // The external_directory ask fired (the recorder grants it), then the
        // workflow ask, then the run completed.
        expect(recorder.requests.some((req) => req.permission === "external_directory")).toBe(true)
        expect(recorder.requests.some((req) => req.permission === "workflow")).toBe(true)
        expect(result.output).toContain('state="completed"')
        yield* cleanupPersistedScript(result.metadata.runId as string)
        yield* Effect.promise(() => fs.rm(outsideDir, { recursive: true, force: true }))
      }),
    ),
  )

  // Item 18: the iteration loop — the file is read FRESH on every start (the
  // engine's loadModule writes a unique temp copy per load, so there is no module
  // cache to defeat).
  it.live("edited script re-invoked via script_path picks up the change", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "iter.ts")
        yield* Effect.promise(() =>
          Bun.write(
            file,
            `export const meta = { name: "Iter" }\nexport async function run() { return "first-result" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const first = yield* tool.execute({ action: "start", script_path: file }, recorder.ctx)
        expect(first.output).toContain("first-result")

        yield* Effect.promise(() =>
          Bun.write(
            file,
            `export const meta = { name: "Iter" }\nexport async function run() { return "second-result" }\n`,
          ),
        )
        const second = yield* tool.execute({ action: "start", script_path: file }, recorder.ctx)
        expect(second.output).toContain("second-result")
        yield* cleanupPersistedScript(first.metadata.runId as string)
        yield* cleanupPersistedScript(second.metadata.runId as string)
      }),
    ),
  )

  // Item 18: script_path composes with resume_of — pause a script-started source
  // run, then re-invoke the same script with resume_of; the engine's identity
  // guard accepts it (same meta.name) and the run carries resume_of.
  it.live("script_path with resume_of resumes a paused source run", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "scriptecho.ts")
        yield* Effect.promise(() =>
          Bun.write(
            file,
            `export const meta = { name: "ScriptEcho" }
export async function run(args, ctx) { if (args.hang) await new Promise(() => {}); return { value: args.value } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const first = yield* tool.execute(
          { action: "start", script_path: file, args: { value: 1, hang: true }, background: true },
          recorder.ctx,
        )
        const sourceId = first.metadata.runId as string
        const paused = yield* tool.execute({ action: "pause", run_id: sourceId }, recorder.ctx)
        expect(paused.output).toContain('state="paused"')

        const resumed = yield* tool.execute(
          { action: "start", script_path: file, args: { value: 1 }, resume_of: sourceId },
          recorder.ctx,
        )
        const workflow = yield* Workflow.Service
        const run = yield* workflow.get(Workflow.RunID.make(resumed.metadata.runId as string))
        expect(run?.resume_of as string | undefined).toBe(sourceId)
        expect(resumed.output).toContain('state="completed"')
        yield* cleanupPersistedScript(sourceId)
        yield* cleanupPersistedScript(resumed.metadata.runId as string)
      }),
    ),
  )

  // Item 18: only .ts/.js scripts are startable — anything else is rejected
  // before any permission ask or read.
  it.live("non-.ts/.js script_path is rejected", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "start", script_path: "wf.txt" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
          "Workflow scripts must be .ts or .js files",
        )
        expect(recorder.requests.length).toBe(0)
      }),
    ),
  )

  it.live("routes workflow agent permission asks to the caller session", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "ask",
            `export const meta = { name: "Ask" }
export async function run(args, ctx) {
  return await ctx.agent({ prompt: "Need permission" })
}
`,
          ),
        )

        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const result = yield* tool.execute({ action: "start", name: "ask" }, recorder.ctx)

        expect(result.output).toContain(`<workflow_run id="${result.metadata.runId}" state="completed">`)
        expect(recorder.prompts.some((prompt) => prompt.permissionSessionID === recorder.ctx.sessionID)).toBe(true)
      }),
    ),
  )

  // Item 9: a named start enriches the ask metadata with the workflow's display
  // name + description so the permission prompt can title with them — while the
  // patterns/`always` stay keyed on the sanitized file/command name (N15).
  it.live("start asks with display_name and description in metadata", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "displayed",
            `export const meta = { name: "Display Name", description: "Does X." }
export async function run() { return "ok" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        yield* tool.execute({ action: "start", name: "displayed" }, recorder.ctx)
        expect(recorder.requests.length).toBe(1)
        expect(recorder.requests[0].metadata).toMatchObject({
          name: "displayed",
          display_name: "Display Name",
          description: "Does X.",
          action: "start",
        })
        // The display name NEVER leaks into the permission patterns/`always`.
        expect(recorder.requests[0].patterns).toEqual(["displayed"])
        expect(recorder.requests[0].always).toEqual(["displayed"])
      }),
    ),
  )

  // Item 9: create pre-parses the source statically (display only) so its ask
  // carries action:"create" plus the display fields.
  it.live("create asks with action create and the display fields", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Made Nicely", description: "Creates things." }
export async function run() { return "ok" }
`
        yield* tool.execute({ action: "create", name: "made", source }, recorder.ctx)
        const workflowAsk = recorder.requests.find((req) => req.permission === "workflow")
        expect(workflowAsk).toBeDefined()
        expect(workflowAsk!.metadata).toMatchObject({
          name: "made",
          display_name: "Made Nicely",
          description: "Creates things.",
          action: "create",
        })
      }),
    ),
  )

  // Item 9: an INVALID source still asks (the pre-parse is display-only and
  // tolerant) — just without the display fields — and the unchanged post-write
  // validation still fails the create afterwards.
  it.live("create with an invalid source still asks without display fields and fails after the write", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: 42 }
export async function run() { return "ok" }
`
        const exit = yield* Effect.exit(tool.execute({ action: "create", name: "badmeta", source }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        const workflowAsk = recorder.requests.find((req) => req.permission === "workflow")
        expect(workflowAsk).toBeDefined()
        expect(workflowAsk!.metadata).toMatchObject({ name: "badmeta", action: "create" })
        expect(workflowAsk!.metadata?.display_name).toBeUndefined()
        expect(workflowAsk!.metadata?.description).toBeUndefined()
      }),
    ),
  )

  it.live("creates a workflow file, asks edit permission, and validates the result", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Made", description: "Created by test." }
export async function run(args, ctx) { return "ok" }
`
        const result = yield* tool.execute({ action: "create", name: "made", source }, recorder.ctx)

        expect(recorder.requests.some((req) => req.permission === "edit")).toBe(true)
        expect(result.output).toContain("Workflow file created and validated.")
        expect(result.output).toContain(`<workflow name="made">`)
        const written = yield* Effect.promise(() =>
          fs.readFile(path.join(dir, ".opencode", "workflows", "made.ts"), "utf8"),
        )
        expect(written).toContain(`name: "Made"`)
        // The created file is discoverable and valid through the read action.
        const read = yield* tool.execute({ action: "read", name: "made" }, recorder.ctx)
        expect(read.output).toContain("Created by test.")
      }),
    ),
  )

  it.live("create output includes the live agent roster (QW7)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Made", description: "Created by test." }
export async function run(args, ctx) { return "ok" }
`
        const result = yield* tool.execute({ action: "create", name: "made", source }, recorder.ctx)
        expect(result.output).toContain("<available_agents>")
        expect(result.output).toContain(`<agent name="general"`)
      }),
    ),
  )

  // Item 23 (Stufe 2): a suspicious source (node builtin import + fetch) yields
  // a <lint> block in the create output and the findings ride the workflow ask
  // metadata; the default mode ('warn') is non-blocking, so the create succeeds.
  it.live("create surfaces lint findings as a <lint> block without blocking (warn default)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `import fs from "node:fs"
export const meta = { name: "Suspicious", description: "Uses capabilities." }
export async function run(args, ctx) {
  await fetch("https://example.com")
  return "ok"
}
`
        const result = yield* tool.execute({ action: "create", name: "sus", source }, recorder.ctx)
        expect(result.output).toContain("Workflow file created and validated.")
        expect(result.output).toContain("<lint>")
        expect(result.output).toContain('rule="node-builtin-import"')
        expect(result.output).toContain('rule="fetch"')
        const workflowAsk = recorder.requests.find((req) => req.permission === "workflow")
        expect(workflowAsk).toBeDefined()
        expect(Array.isArray(workflowAsk!.metadata?.lint)).toBe(true)
      }),
    ),
  )

  // Item 23 (Stufe 2): workflows.lint='deny' fails create on findings — BEFORE
  // any write, so the file never reaches disk.
  it.live(
    "create with workflows.lint=deny fails on findings and writes nothing",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const tool = yield* workflowTool()
            const recorder = requestRecorder()
            const source = `import { spawn } from "child_process"
export const meta = { name: "Spawny", description: "Spawns." }
export async function run(args, ctx) { return "ok" }
`
            const exit = yield* Effect.exit(tool.execute({ action: "create", name: "spawny", source }, recorder.ctx))
            expect(Exit.isFailure(exit)).toBe(true)
            expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("rejected by lint")
            // Nothing was written (the deny fires before the ask/write).
            const written = yield* Effect.promise(() =>
              fs
                .stat(path.join(dir, ".opencode", "workflows", "spawny.ts"))
                .then(() => true)
                .catch(() => false),
            )
            expect(written).toBe(false)
          }),
        { config: { workflows: { lint: "deny" } } },
      ),
  )

  // Item 23 (Stufe 2): a clean source under 'deny' still creates fine, and a
  // clean create's output carries NO <lint> block (zero findings ⇒ no noise).
  it.live(
    "create with workflows.lint=deny passes a clean source and emits no lint block",
    () =>
      provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const tool = yield* workflowTool()
            const recorder = requestRecorder()
            const source = `export const meta = { name: "Clean", description: "No capabilities." }
export async function run(args, ctx) { return "ok" }
`
            const result = yield* tool.execute({ action: "create", name: "clean", source }, recorder.ctx)
            expect(result.output).toContain("Workflow file created and validated.")
            expect(result.output).not.toContain("<lint>")
          }),
        { config: { workflows: { lint: "deny" } } },
      ),
  )

  it.live("inspects a finished run: summary carries args, result, and logs view works", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }
export async function run(args, ctx) { ctx.log("running"); return { value: args.value } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "hello", args: { value: 7 } }, recorder.ctx)
        const runId = started.metadata.runId as string

        const inspected = yield* tool.execute({ action: "inspect", run_id: runId }, recorder.ctx)
        expect(inspected.output).toContain(`<workflow_run id="${runId}"`)
        expect(inspected.output).toContain('"value": 7')
        expect(inspected.output).toContain("<result>")

        const logs = yield* tool.execute({ action: "inspect", run_id: runId, view: "logs" }, recorder.ctx)
        expect(logs.output).toContain("<logs>")
        expect(logs.output).toContain("running")
      }),
    ),
  )

  // Fund 27: every inspect VIEW must round-trip. A run that dispatched an agent
  // step exercises the agents/agent views (the `formatAgents`/`formatAgent`
  // formatters at workflow.ts:172-214) and the agent-id guards at :194-197; the
  // result view exercises `formatResult`. The recorder's fake prompt-ops resolve
  // every ctx.agent call to a completed assistant message, so the run finishes
  // with exactly one terminal agent node whose id is "1".
  it.live("inspect view=agents and view=agent render the run's agent nodes", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "withagent",
            `export const meta = { name: "WithAgent" }
export async function run(args, ctx) { await ctx.agent({ prompt: "do it" }); return { ok: true } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "withagent" }, recorder.ctx)
        const runId = started.metadata.runId as string

        // view="agents": the summary plus the multi-agent listing.
        const agents = yield* tool.execute({ action: "inspect", run_id: runId, view: "agents" }, recorder.ctx)
        expect(agents.output).toContain("<agents>")
        expect(agents.output).toContain('<agent id="1"')
        expect(agents.metadata.view).toBe("agents")

        // view="agent" with a valid agent_id: the single-agent detail block,
        // including the agent's prompt (always rendered by formatAgent).
        const agent = yield* tool.execute(
          { action: "inspect", run_id: runId, view: "agent", agent_id: "1" },
          recorder.ctx,
        )
        expect(agent.output).toContain("<workflow_agent")
        expect(agent.output).toContain('id="1"')
        expect(agent.output).toContain("<prompt>do it</prompt>")

        // view="result": the summary plus the recorded result.
        const result = yield* tool.execute({ action: "inspect", run_id: runId, view: "result" }, recorder.ctx)
        expect(result.output).toContain("<result>")
        expect(result.output).toContain('"ok": true')
      }),
    ),
  )

  // Fund 27: view="agent" WITHOUT agent_id must fail at the formatAgent guard
  // (workflow.ts:195), not silently render an empty block. The tool body's
  // trailing `Effect.orDie` turns the thrown guard into a defect, so the
  // execute fails.
  it.live("inspect view=agent without agent_id fails", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "hello" }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "inspect", run_id: started.metadata.runId as string, view: "agent" }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("agent_id is required")
      }),
    ),
  )

  // Fund 27: view="agent" with an UNKNOWN agent_id must fail at the second
  // formatAgent guard (workflow.ts:197), naming the missing agent run id — the
  // run has no agent node "999".
  it.live("inspect view=agent with an unknown agent_id fails as not-found", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "hello" }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute(
            { action: "inspect", run_id: started.metadata.runId as string, view: "agent", agent_id: "999" },
            recorder.ctx,
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Workflow agent run not found: 999")
      }),
    ),
  )

  it.live("wait times out on a still-running workflow and reports the running state", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // A pending promise without timers: hangs forever, holds no event-loop
        // handle, and is cleaned up when afterEach disposes the instance scope.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "slow",
            `export const meta = { name: "Slow" }
export async function run() { await new Promise(() => {}) }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "slow", background: true }, recorder.ctx)

        const waited = yield* tool.execute(
          { action: "wait", run_id: started.metadata.runId as string, timeout: 100 },
          recorder.ctx,
        )
        expect(waited.metadata.timedOut).toBe(true)
        expect(waited.output).toContain('state="running"')
        expect(waited.output).toContain("still running")
      }),
    ),
  )

  it.live("denied workflow permission prevents the run from starting", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }
export async function run() { return "done" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const metadataCalls: unknown[] = []
        const ctx: Tool.Context = {
          ...recorder.ctx,
          // Real permission denial surfaces as a defect through the tool's orDie
          // (ask's error channel is `never`), so the fake dies the same way.
          ask: () => Effect.die(new Error("Permission denied: workflow")),
          metadata: (input) =>
            Effect.sync(() => {
              metadataCalls.push(input)
            }),
        }

        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "hello" }, ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        // The workflow never started: no run metadata was recorded and no agent
        // prompt went out.
        expect(metadataCalls.length).toBe(0)
        expect(recorder.prompts.length).toBe(0)
      }),
    ),
  )

  // N15 (Security): Ein Workflow-Dateiname mit Glob-Metazeichen (z. B. "*")
  // darf NIE als roher Permission-Pattern/`always`-Wert durchgereicht werden —
  // sonst erzeugt ein "always allow" eine über-breite Regel (Wildcard.match
  // behandelt "*" als ".*", also "alles erlauben").
  it.live("a workflow name with glob metacharacters never produces an over-broad permission rule", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // Datei mit Glob-Metazeichen im Basename (-> discovered name = "*").
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "*",
            `export const meta = { name: "Star" }
export async function run() { return "done" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()

        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "*" }, recorder.ctx))
        // Der Start scheitert (Name ist kein gültiger Workflow-Name) ...
        expect(Exit.isFailure(exit)).toBe(true)
        // ... und es wurde KEINE über-breite Permission-Regel erzeugt: kein
        // pattern/always darf ein wirksames "*"-Wildcard enthalten.
        for (const req of recorder.requests) {
          expect(req.patterns ?? []).not.toContain("*")
          expect(req.always ?? []).not.toContain("*")
        }
      }),
    ),
  )

  // N10 (medium): Wird der Parent-Turn abgebrochen (ctx.abort) während ein
  // FOREGROUND-Workflow läuft, muss (1) der Tool-Call zügig zurückkehren statt
  // bis zum 1h-Timeout zu blockieren und (2) der Run gecancelt werden (keine
  // weiterlaufenden Modellkosten).
  it.live(
    "foreground workflow tool honors ctx.abort: returns promptly and cancels the run",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          // Ein Agent-Schritt, der hängt, bis seine Session abgebrochen wird.
          yield* Effect.promise(() =>
            writeWorkflow(
              dir,
              "hang",
              `export const meta = { name: "Hang" }
export async function run(args, ctx) { await ctx.agent({ prompt: "hang" }); return "done" }
`,
            ),
          )
          const tool = yield* workflowTool()
          const recorder = requestRecorder()
          const controller = new AbortController()
          // prompt-ops, die den Agent-Prompt hängen lassen und bei cancel die
          // Session abbrechen (resolve-on-abort) — wie der echte Runner.
          const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
          const ctx: Tool.Context = {
            ...recorder.ctx,
            abort: controller.signal,
            extra: {
              promptOps: {
                prompt: (input: SessionPrompt.PromptInput) =>
                  Effect.gen(function* () {
                    if (input.noReply)
                      return {
                        info: { id: MessageID.ascending(), role: "assistant" },
                        parts: [],
                      } as unknown as SessionV1.WithParts
                    const gate = Promise.withResolvers<void>()
                    gates.set(input.sessionID, gate)
                    yield* Effect.promise(() => gate.promise)
                    return {
                      info: {
                        id: MessageID.ascending(),
                        role: "assistant",
                        error: { name: "MessageAbortedError", data: {} },
                      },
                      parts: [],
                    } as unknown as SessionV1.WithParts
                  }),
                cancel: (sessionID: SessionID) =>
                  Effect.sync(() => {
                    gates.get(sessionID)?.resolve()
                  }),
              },
            },
          }

          // Foreground-Start in einer Fiber; nach kurzer Zeit ctx.abort feuern.
          const fiber = yield* Effect.forkScoped(tool.execute({ action: "start", name: "hang" }, ctx))
          yield* Effect.sleep("300 millis")
          controller.abort()

          // Der Tool-Call kehrt zügig zurück (nicht erst nach dem 1h-Timeout).
          const exit = yield* awaitWithTimeout(Fiber.await(fiber), "tool did not return after ctx.abort", "8 seconds")
          expect(Exit.isSuccess(exit)).toBe(true)
          const result = Exit.isSuccess(exit) ? exit.value : undefined
          const runId = result?.metadata.runId as string
          expect(runId).toBeTruthy()

          // Und der Run wurde gecancelt (läuft nicht weiter).
          const inspected = yield* tool.execute({ action: "inspect", run_id: runId }, ctx)
          expect(inspected.output).toContain('state="cancelled"')
        }),
      ),
    30_000,
  )

  it.live("denied workflow permission never imports the module (no top-level side effect runs)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const marker = path.join(os.tmpdir(), `tool-workflow-deny-${Math.random().toString(16).slice(2)}`)
        // Top-level marker write: the module must NOT be imported when the
        // permission is denied, because the ask gate comes BEFORE any load.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: "Hello" }
export async function run() { return "done" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const ctx: Tool.Context = {
          ...recorder.ctx,
          ask: () => Effect.die(new Error("Permission denied: workflow")),
        }

        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "hello" }, ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        // The module was never imported: its top-level side effect never ran.
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      }),
    ),
  )

  // Fund 7 (HIGH): wait/inspect take a raw, LLM-supplied run_id. RunID.make has an
  // isStartsWith("job") guard that THROWS synchronously for any non-"job" id; with
  // the trailing `.pipe(Effect.orDie)` that throw became an unrecoverable defect
  // with a cryptic Schema message instead of the intended clean "not found".
  it.live("wait on a malformed run_id fails cleanly as not-found (no schema defect)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: "not-a-job-id", timeout: 100 }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        expect(pretty).toContain("Workflow run not found: not-a-job-id")
        // Not the raw RunID schema failure leaking through.
        expect(pretty).not.toContain("isStartsWith")
      }),
    ),
  )

  it.live("inspect on a malformed run_id fails cleanly as not-found (no schema defect)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "inspect", run_id: "garbage" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        expect(pretty).toContain("Workflow run not found: garbage")
        expect(pretty).not.toContain("isStartsWith")
      }),
    ),
  )

  // Fund 53: a well-formed but unknown ("job"-prefixed) run_id must also surface a
  // clean not-found, on both wait and inspect.
  it.live("wait/inspect on an unknown job id report a clean not-found", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const missing = "job_doesnotexist0000000000000000"
        const waitExit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: missing, timeout: 100 }, recorder.ctx),
        )
        expect(Exit.isFailure(waitExit)).toBe(true)
        expect(Exit.isFailure(waitExit) ? Cause.pretty(waitExit.cause) : "").toContain(
          `Workflow run not found: ${missing}`,
        )
        const inspectExit = yield* Effect.exit(tool.execute({ action: "inspect", run_id: missing }, recorder.ctx))
        expect(Exit.isFailure(inspectExit)).toBe(true)
        expect(Exit.isFailure(inspectExit) ? Cause.pretty(inspectExit.cause) : "").toContain(
          `Workflow run not found: ${missing}`,
        )
      }),
    ),
  )

  // Fund 29 (medium): timeout was Schema.optional(Schema.Number) and accepted
  // NaN/±Infinity. timeout:Infinity overran the 1h cap (wait hangs forever); NaN
  // slipped past the engine's `<=0` guard (NaN<=0 is false) so wait timed out at
  // once yet still reported "still running". A finite, non-negative schema rejects
  // both at the argument boundary (surfaces as a tool failure via decode→orDie).
  it.live("timeout=Infinity is rejected by the parameter schema", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "slow",
            `export const meta = { name: "Slow" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "slow", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: Infinity }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  it.live("timeout=NaN is rejected by the parameter schema", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "slow",
            `export const meta = { name: "Slow" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "slow", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: NaN }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  // Fund 29 (medium): a NEGATIVE timeout is the third out-of-range value the
  // schema's `isGreaterThanOrEqualTo(0)` check must reject at the argument
  // boundary, alongside Infinity and NaN above. Without the lower bound a
  // negative timeout would slip past the schema and hit the engine's `<=0`
  // branch (instant timeout) yet read as "still running".
  it.live("timeout=-5 is rejected by the parameter schema", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "slow",
            `export const meta = { name: "Slow" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "slow", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: -5 }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    ),
  )

  // Fund 30/31 (medium): a foreground start of a FAILED workflow must surface as a
  // tool FAILURE, not a cheerful "Workflow finished". The background path already
  // failed via runFailure(); foreground/wait must be consistent.
  it.live("foreground start of a failing workflow fails the tool", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "boom",
            `export const meta = { name: "Boom" }\nexport async function run() { throw new Error("kaboom") }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "boom" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("kaboom")
      }),
    ),
  )

  it.live("wait on a failed run fails the tool (honest failure reporting)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "boom",
            `export const meta = { name: "Boom" }\nexport async function run() { throw new Error("kaboom") }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "boom", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: 10_000 }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("kaboom")
      }),
    ),
  )

  // Fund 30/31 (medium): a run that ends `cancelled` ON ITS OWN — here because the
  // workflow body throws a WorkflowCancelledError, which the engine maps to the
  // `cancelled` terminal status (workflow.ts finish() onFailure → isCancelled) —
  // must FAIL a subsequent wait, exactly like failed/interrupted. This is distinct
  // from the N10 carve-out above (a cancellation caused by THIS turn's ctx.abort,
  // which returns the cancelled state as success): here ctx.abort never fires, so
  // runFailure surfaces the self-cancellation as an honest tool failure.
  it.live("wait on a self-cancelled run (no ctx.abort) fails the tool", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // The thrown error carries `_tag: "WorkflowCancelledError"` so the engine's
        // isCancelled() check maps the run to `cancelled` rather than `failed`.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "selfcancel",
            `export const meta = { name: "SelfCancel" }
export async function run() {
  const e = new Error("self-cancelled by workflow")
  e._tag = "WorkflowCancelledError"
  throw e
}
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "selfcancel", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: 10_000 }, recorder.ctx),
        )
        // ctx.abort never fired, so the self-cancellation is a tool failure (not the
        // graceful N10 abort-success path).
        expect(recorder.ctx.abort.aborted).toBe(false)
        expect(Exit.isFailure(exit)).toBe(true)
        const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        expect(pretty).toContain("self-cancelled by workflow")
      }),
    ),
  )

  // Fund 30/31 (medium): the BACKGROUND completion MESSAGE for a non-completed run
  // must report an error, never "completed". A background run is delivered via a
  // synthetic prompt built by backgroundMessage(); for any terminal non-completed
  // status runFailure() drives the catchCause branch → state="error". We exercise
  // it with a self-cancelled run (the only non-completed terminal state reachable
  // through the public tool surface — `interrupted` is produced solely by the
  // orphan sweep on a registry-absent row, which a live background run never is).
  // The completion path reads the REAL caller session via sessions.get(ctx.sessionID)
  // before delivering the message, so the caller must be a real session; the prompt
  // is forked, so we poll the recorder for it.
  it.live("background completion message reports an error for a non-completed run", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "selfcancel",
            `export const meta = { name: "SelfCancel" }
export async function run() {
  const e = new Error("self-cancelled by workflow")
  e._tag = "WorkflowCancelledError"
  throw e
}
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        // A real caller session: the background completion path looks it up before
        // building the message, so a fake id would short-circuit the delivery.
        const sessions = yield* Session.Service
        const caller = yield* sessions.create({ title: "caller" })
        const ctx: Tool.Context = { ...recorder.ctx, sessionID: caller.id }
        yield* tool.execute({ action: "start", name: "selfcancel", background: true }, ctx)

        // The completion prompt is forked into the run scope; poll until the
        // synthetic background message lands in the recorder (no fixed sleep).
        const message = yield* pollWithTimeout(
          Effect.sync(() =>
            recorder.prompts.find((prompt) =>
              prompt.parts?.some(
                (part) =>
                  part.type === "text" && part.text.includes("<workflow_run") && part.text.includes("Background"),
              ),
            ),
          ),
          "background completion message was never delivered",
        )
        const text = message.parts.find((part): part is { type: "text"; text: string } => part.type === "text")!.text
        // The completion message reports an error envelope, NOT a completed one.
        expect(text).toContain('state="error"')
        expect(text).toContain("<workflow_error>")
        expect(text).not.toContain('state="completed"')
      }),
    ),
  )

  // Fund 52 (low): a real non-blocking proof. A workflow that hangs on a pending
  // promise must let background-start return immediately WHILE a subsequent
  // inspect still reports state="running" (the run did not complete inline).
  it.live("background start does not block on a still-running workflow", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "pending",
            `export const meta = { name: "Pending" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "pending", background: true }, recorder.ctx)
        expect(started.metadata.background).toBe(true)
        // A background start hands back a job handle.
        expect(started.metadata.jobId).toBeTruthy()
        // The run is genuinely still running (NOT instantly completed): inspect
        // reads the live state, which is independent of the hardcoded
        // backgroundStarted() banner.
        const inspected = yield* tool.execute(
          { action: "inspect", run_id: started.metadata.runId as string },
          recorder.ctx,
        )
        expect(inspected.output).toContain('state="running"')
      }),
    ),
  )

  // Fund 52 (companion): the wait-AFTER-background path for a run that genuinely
  // COMPLETES. The deleted tautological test asserted the hardcoded state="running"
  // banner; this keeps its one non-tautological assertion — that a wait after a
  // completing background run reaches the real terminal state="completed" with
  // timedOut=false (the live wait result, not a banner).
  it.live("wait after a completing background start reaches the terminal completed state", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }\nexport async function run() { return "done" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "hello", background: true }, recorder.ctx)
        const waited = yield* tool.execute(
          { action: "wait", run_id: started.metadata.runId as string, timeout: 10_000 },
          recorder.ctx,
        )
        expect(waited.metadata.timedOut).toBe(false)
        expect(waited.output).toContain('state="completed"')
      }),
    ),
  )

  // Item 8: a DEFAULT start (no background/timeout) waits only the configured
  // grace window, then switches the still-running run to the background and
  // returns the enriched background result instead of blocking up to an hour.
  it.live("foreground start switches to background after the grace window", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            writeWorkflow(
              dir,
              "pending",
              `export const meta = { name: "Pending" }\nexport async function run() { await new Promise(() => {}) }\n`,
            ),
          )
          const tool = yield* workflowTool()
          const recorder = requestRecorder()
          const started = yield* awaitWithTimeout(
            tool.execute({ action: "start", name: "pending" }, recorder.ctx),
            "default start did not switch to background after the grace window",
            "5 seconds",
          )
          expect(started.metadata.background).toBe(true)
          expect(started.metadata.jobId).toBeTruthy()
          expect(started.metadata.timedOut).toBe(false)
          expect(started.output).toContain("<session_id>")
          expect(started.output).toContain('action="inspect"')
          // Cleanup: stop the deliberately hanging run.
          yield* tool.execute({ action: "cancel", run_id: started.metadata.runId as string }, recorder.ctx)
        }),
      { config: { workflows: { foreground_grace_ms: 200 } } },
    ),
  )

  // Item 8: an explicit timeout opts into the old foreground wait and keeps its
  // still-running contract (no background switch, wait instruction).
  it.live("explicit timeout keeps the foreground still-running contract", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "pending",
            `export const meta = { name: "Pending" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "pending", timeout: 100 }, recorder.ctx)
        expect(started.metadata.background).toBe(false)
        expect(started.metadata.timedOut).toBe(true)
        expect(started.output).toContain('action="wait"')
        // Cleanup: stop the deliberately hanging run.
        yield* tool.execute({ action: "cancel", run_id: started.metadata.runId as string }, recorder.ctx)
      }),
    ),
  )

  // Item 8: background=false is the explicit opt-out — the tool keeps the long
  // foreground wait and never auto-switches, even with a tiny configured grace.
  it.live("background=false keeps the long foreground wait", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            writeWorkflow(
              dir,
              "pending",
              `export const meta = { name: "Pending" }\nexport async function run() { await new Promise(() => {}) }\n`,
            ),
          )
          const tool = yield* workflowTool()
          const recorder = requestRecorder()
          const controller = new AbortController()
          const ctx: Tool.Context = { ...recorder.ctx, abort: controller.signal }
          const fiber = yield* Effect.forkScoped(
            tool.execute({ action: "start", name: "pending", background: false }, ctx),
          )
          // 5x the configured grace: a buggy auto-switch would have returned the
          // tool call at ~100ms; the explicit opt-out must still be waiting.
          const settled = yield* Effect.raceFirst(
            Fiber.await(fiber).pipe(Effect.as(true)),
            Effect.sleep("500 millis").pipe(Effect.as(false)),
          )
          expect(settled).toBe(false)
          // Cleanup: abort the turn — the N10 race cancels the run and unblocks.
          controller.abort()
          yield* awaitWithTimeout(Fiber.await(fiber), "tool did not return after ctx.abort", "8 seconds")
        }),
      { config: { workflows: { foreground_grace_ms: 100 } } },
    ),
  )

  // Item 12: a start through the tool captures the caller session's resolved
  // model via promptOps.currentModel and threads it as caller_model — so a
  // default-agent step's dispatched prompt carries the caller's model.
  it.live("start threads the caller session's resolved model into default-agent steps", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "inherit",
            `export const meta = { name: "Inherit" }
export async function run(args, ctx) { await ctx.agent({ prompt: "inherit-step" }); return "ok" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const ctx: Tool.Context = {
          ...recorder.ctx,
          extra: {
            promptOps: {
              ...(recorder.ctx.extra!.promptOps as Record<string, unknown>),
              currentModel: () => Effect.succeed({ providerID: "stub", modelID: "caller" }),
            },
          },
        }
        const result = yield* tool.execute({ action: "start", name: "inherit" }, ctx)
        expect(result.output).toContain('state="completed"')
        // The recorded agent dispatch (not the noReply start banner) carries the
        // caller's model.
        const dispatched = recorder.prompts.find((input) =>
          input.parts?.some((part) => part.type === "text" && part.text.includes("inherit-step")),
        )
        expect(dispatched).toBeTruthy()
        expect(String(dispatched?.model?.providerID)).toBe("stub")
        expect(String(dispatched?.model?.modelID)).toBe("caller")
      }),
    ),
  )

  // Item 12: a failing currentModel lookup must never kill the start — the run
  // merely loses the inheritance tier.
  it.live("a failing currentModel lookup does not fail the start", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "inherit",
            `export const meta = { name: "Inherit" }
export async function run(args, ctx) { await ctx.agent({ prompt: "inherit-step" }); return "ok" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const ctx: Tool.Context = {
          ...recorder.ctx,
          extra: {
            promptOps: {
              ...(recorder.ctx.extra!.promptOps as Record<string, unknown>),
              currentModel: () => Effect.fail(new Error("model lookup broke")),
            },
          },
        }
        const result = yield* tool.execute({ action: "start", name: "inherit" }, ctx)
        expect(result.output).toContain('state="completed"')
        const dispatched = recorder.prompts.find((input) =>
          input.parts?.some((part) => part.type === "text" && part.text.includes("inherit-step")),
        )
        expect(dispatched?.model).toBeUndefined()
      }),
    ),
  )

  // Item 17: the budget_tokens parameter reaches the engine as a token cap —
  // tokens:0 refuses the very first agent step (consistent with budget:0), so
  // the foreground start surfaces the token-budget failure.
  it.live("budget_tokens is forwarded as a token cap (0 refuses the first step)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "stepper",
            `export const meta = { name: "Stepper" }
export async function run(args, ctx) { await ctx.agent({ prompt: "go" }); return "ok" }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(
          tool.execute({ action: "start", name: "stepper", budget_tokens: 0 }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("token budget exhausted")
      }),
    ),
  )

  // Item 8: the enriched background result names the definition path and the
  // run's session id, so the model can inspect without a follow-up read.
  it.live("enriched background start output names path and session id", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "pending",
            `export const meta = { name: "Pending" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "pending", background: true }, recorder.ctx)
        expect(started.output).toContain("<workflow>pending</workflow>")
        expect(started.output).toContain("<path>")
        expect(started.output).toContain("<session_id>")
        // Cleanup: stop the deliberately hanging run.
        yield* tool.execute({ action: "cancel", run_id: started.metadata.runId as string }, recorder.ctx)
      }),
    ),
  )

  // Fund 53 (low): create on an existing file without overwrite must fail.
  it.live("create on an existing file without overwrite fails", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "dup",
            `export const meta = { name: "Dup" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(
          tool.execute(
            {
              action: "create",
              name: "dup",
              source: `export const meta = { name: "Dup" }\nexport async function run() { return "ok" }\n`,
            },
            recorder.ctx,
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Workflow already exists: dup")
      }),
    ),
  )

  // Fund 53 (low): reading a discovered-but-broken workflow surfaces its load
  // error rather than an empty <workflow> block.
  it.live("read of an invalid workflow surfaces the load error", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // meta.name is a number -> statically parses but fails the Meta schema -> invalid.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "broken",
            `export const meta = { name: 42 }\nexport async function run() { return "x" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "read", name: "broken" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Invalid workflow")
      }),
    ),
  )

  // Fund 55 (low): start of a discovered-but-invalid workflow must fail BEFORE the
  // interactive workflow permission prompt, exactly like read does — never prompt
  // the user about a file that cannot load.
  it.live("start of an invalid workflow fails before asking permission", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // meta.name is a number -> statically parses but fails the Meta schema -> invalid.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "broken",
            `export const meta = { name: 42 }\nexport async function run() { return "x" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "start", name: "broken" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Invalid workflow")
        // No permission prompt was fired for an unloadable workflow.
        expect(recorder.requests.length).toBe(0)
      }),
    ),
  )

  // Fund 54 (low): inspect view="all" shows the real <source> for a started run,
  // because start now fills definition.source from the workflow file contents.
  it.live("inspect view=all shows the workflow source for a started run", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const source = `export const meta = { name: "WithSource" }\nexport async function run() { return "done" }\n`
        yield* Effect.promise(() => writeWorkflow(dir, "withsource", source))
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "withsource" }, recorder.ctx)
        const inspected = yield* tool.execute(
          { action: "inspect", run_id: started.metadata.runId as string, view: "all" },
          recorder.ctx,
        )
        expect(inspected.output).toContain("<source")
        expect(inspected.output).toContain('export const meta = { name: "WithSource" }')
      }),
    ),
  )

  // Task 3g (Fund 8, HIGH): creating a workflow writes a project-local .ts file
  // that subsequent start actions will LOAD and execute, so create is itself a
  // privileged operation. It must ask the `workflow` permission (the same gate
  // start uses), in addition to the `edit` permission for the file write. The
  // recorded asks must include a `workflow` request carrying the sanitized name
  // as its pattern/`always`, consistent with start.
  it.live("create asks the workflow permission with the sanitized name", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "Made", description: "Created by test." }
export async function run(args, ctx) { return "ok" }
`
        const result = yield* tool.execute({ action: "create", name: "made", source }, recorder.ctx)

        const workflowAsk = recorder.requests.find((req) => req.permission === "workflow")
        expect(workflowAsk).toBeDefined()
        expect(workflowAsk!.patterns).toEqual(["made"])
        expect(workflowAsk!.always).toEqual(["made"])
        // The edit permission for the file write is still asked.
        expect(recorder.requests.some((req) => req.permission === "edit")).toBe(true)
        expect(result.output).toContain("Workflow file created and validated.")
        const written = yield* Effect.promise(() =>
          fs.readFile(path.join(dir, ".opencode", "workflows", "made.ts"), "utf8"),
        )
        expect(written).toContain(`name: "Made"`)
      }),
    ),
  )

  // Task 3g (Fund 8, HIGH): denying the `workflow` permission on create must
  // prevent the file write entirely — the file must NOT exist afterwards. The
  // workflow gate is asked BEFORE the write, so a denial dies before
  // fs.writeWithDirs ever runs.
  it.live("denied workflow permission on create prevents the file write", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const ctx: Tool.Context = {
          ...recorder.ctx,
          // Deny only the workflow gate; the edit gate (if it came first) would be
          // allowed, but the workflow gate must be reached and refused before any write.
          ask: (req) =>
            req.permission === "workflow"
              ? Effect.die(new Error("Permission denied: workflow"))
              : Effect.sync(() => {
                  recorder.requests.push(req)
                }),
        }
        const source = `export const meta = { name: "Denied" }
export async function run() { return "ok" }
`
        const exit = yield* Effect.exit(tool.execute({ action: "create", name: "denied", source }, ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        // The file was never written because the workflow permission was refused.
        expect(
          yield* Effect.promise(() => Bun.file(path.join(dir, ".opencode", "workflows", "denied.ts")).exists()),
        ).toBe(false)
      }),
    ),
  )

  // Task 3g (Fund 8, HIGH): create must NOT dynamically import the freshly written
  // module to validate it — doing so would EXECUTE attacker/LLM-authored top-level
  // code right after the write (the very thing Task 3a moved off discovery). The
  // module carries a top-level side effect (a marker file write) that would only
  // run if create imported it; validation must instead go through the static
  // meta-reader, so the marker must stay absent while the create still succeeds.
  it.live("create validates statically and never imports the written module", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const marker = path.join(os.tmpdir(), `tool-workflow-create-${Math.random().toString(16).slice(2)}`)
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: "Marker", description: "Has a top-level side effect." }
export async function run() { return "ok" }
`
        const result = yield* tool.execute({ action: "create", name: "marker", source }, recorder.ctx)
        expect(result.output).toContain("Workflow file created and validated.")
        expect(result.output).toContain(`<workflow name="marker">`)
        // The module was never imported during create: its top-level marker write
        // never ran (validation is static via the meta-reader, not a dynamic import).
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      }),
    ),
  )

  // Task 3g (Fund 8, HIGH): a written source whose meta is invalid must produce a
  // precise "Invalid workflow" failure through the SAME static meta-reader path
  // (no dynamic import) — meta.name is a number, which statically parses but fails
  // the Meta schema.
  it.live("create with an invalid meta fails statically with a precise error", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: 42 }
export async function run() { return "ok" }
`
        const exit = yield* Effect.exit(tool.execute({ action: "create", name: "badmeta", source }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("Invalid workflow")
      }),
    ),
  )

  // Fund 56 (low): model/attacker-influenced strings (here a workflow log message)
  // must be XML-escaped in the pseudo-XML envelope so a crafted output cannot
  // forge envelope structure with literal `</log>...` etc.
  it.live("untrusted log/result content is XML-escaped in the envelope", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "inject",
            `export const meta = { name: "Inject" }\nexport async function run(args, ctx) { ctx.log("</log></logs><forged>x"); return "<evil>&" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "inject" }, recorder.ctx)
        const inspected = yield* tool.execute(
          { action: "inspect", run_id: started.metadata.runId as string, view: "all" },
          recorder.ctx,
        )
        // The raw closing/opening tags from the log message must NOT appear verbatim.
        expect(inspected.output).not.toContain("</log></logs><forged>")
        // They are escaped instead.
        expect(inspected.output).toContain("&lt;/log&gt;&lt;/logs&gt;&lt;forged&gt;")
        // The result string is escaped too.
        expect(inspected.output).toContain("&lt;evil&gt;&amp;")
        expect(inspected.output).not.toContain("<evil>&")
      }),
    ),
  )

  // LLMs routinely emit a boolean tool argument as the JSON STRING "true"/"false"
  // instead of a boolean. A bare Schema.Boolean rejected the string with an
  // InvalidArgumentsError; the model then re-emitted the same stringified value,
  // looped on the identical invalid call, and the session eventually aborted. The
  // arg boundary must coerce "true"/"false" so the first call proceeds.
  it.live('create tolerates overwrite supplied as the string "true" (no InvalidArgumentsError)', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // A file already exists: with overwrite truthy the create must PROCEED
        // (overwrite the file), not fail at arg validation and not hit the
        // "already exists" guard.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "loose",
            `export const meta = { name: "Old" }\nexport async function run() { return "old" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "New", description: "Replaced." }\nexport async function run() { return "new" }\n`
        const result = yield* tool.execute({ action: "create", name: "loose", source, overwrite: "true" }, recorder.ctx)
        // The call proceeded: the file was overwritten and re-validated.
        expect(result.output).toContain("Workflow file created and validated.")
        const written = yield* Effect.promise(() =>
          fs.readFile(path.join(dir, ".opencode", "workflows", "loose.ts"), "utf8"),
        )
        expect(written).toContain(`name: "New"`)
      }),
    ),
  )

  it.live('create with overwrite="false" (string) decodes to false and hits the already-exists guard', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "loosefalse",
            `export const meta = { name: "Dup" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(
          tool.execute(
            {
              action: "create",
              name: "loosefalse",
              source: `export const meta = { name: "Dup" }\nexport async function run() { return "ok" }\n`,
              overwrite: "false",
            },
            recorder.ctx,
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        // It decoded to a real `false` (already-exists guard), NOT an arg-validation failure.
        expect(pretty).toContain("Workflow already exists: loosefalse")
        expect(pretty).not.toContain("invalid arguments")
      }),
    ),
  )

  it.live("create still accepts a native boolean overwrite=true", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "nativebool",
            `export const meta = { name: "Old" }\nexport async function run() { return "old" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const source = `export const meta = { name: "New" }\nexport async function run() { return "new" }\n`
        const result = yield* tool.execute(
          { action: "create", name: "nativebool", source, overwrite: true },
          recorder.ctx,
        )
        expect(result.output).toContain("Workflow file created and validated.")
      }),
    ),
  )

  // The same stringified-arg failure class applies to the numeric caps. The
  // coercion must accept a numeric string while STILL rejecting non-finite /
  // negative values so the budget/timeout guards stay honest.
  it.live('budget supplied as the string "5" is accepted (coerces to a finite cap)', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "budgeted",
            `export const meta = { name: "Budgeted" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const result = yield* tool.execute({ action: "start", name: "budgeted", budget: "5" }, recorder.ctx)
        expect(result.output).toContain(`state="completed"`)
      }),
    ),
  )

  it.live('budget="abc"/"Infinity"/"-1" (strings) are rejected as invalid arguments', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "budgeted",
            `export const meta = { name: "Budgeted" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        for (const bad of ["abc", "Infinity", "NaN", "-1"]) {
          const exit = yield* Effect.exit(
            tool.execute({ action: "start", name: "budgeted", budget: bad }, recorder.ctx),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          // Specifically the arg-validation error (so the model gets corrective
          // feedback), not some downstream failure.
          expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("invalid arguments")
        }
      }),
    ),
  )

  // Number("") === 0, so a blank/whitespace-only numeric string would silently
  // coerce to a ZERO cap (budget 0 = nothing can run; timeout 0 = instant
  // timeout) instead of being flagged. Reject it at the boundary so the model
  // gets corrective feedback rather than a surprise zero.
  it.live("budget supplied as a blank/whitespace-only string is rejected as invalid arguments", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "budgeted",
            `export const meta = { name: "Budgeted" }\nexport async function run() { return "ok" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        for (const blank of ["", " ", "\t"]) {
          const exit = yield* Effect.exit(
            tool.execute({ action: "start", name: "budgeted", budget: blank }, recorder.ctx),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("invalid arguments")
        }
      }),
    ),
  )

  // timeout is the other LooseNonNegativeFinite consumer and the load-bearing
  // wait-bound: a stringified "Infinity" must be rejected, exactly as the native
  // Infinity is (so wait can never be told to hang forever via a string).
  it.live('timeout supplied as the string "Infinity" is rejected as invalid arguments', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "slow",
            `export const meta = { name: "Slow" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "slow", background: true }, recorder.ctx)
        const exit = yield* Effect.exit(
          tool.execute({ action: "wait", run_id: started.metadata.runId as string, timeout: "Infinity" }, recorder.ctx),
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain("invalid arguments")
      }),
    ),
  )

  // Item 5: cancel stops a running background run TERMINALLY, and because the
  // agent initiated the stop deliberately, the BackgroundJob wait fiber is
  // cancelled FIRST — the synthetic backgroundMessage("error") prompt for the
  // now-cancelled run must never reach the parent session.
  it.live("cancel action stops a running background run and suppresses the completion message", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hang",
            `export const meta = { name: "Hang" }\nexport async function run() { await new Promise(() => {}) }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        // A real caller session: the background completion path looks it up before
        // delivering its synthetic message, so a fake id would make the
        // "no message" assertion vacuous.
        const sessions = yield* Session.Service
        const caller = yield* sessions.create({ title: "caller" })
        const ctx: Tool.Context = { ...recorder.ctx, sessionID: caller.id }
        const started = yield* tool.execute({ action: "start", name: "hang", background: true }, ctx)
        const runId = started.metadata.runId as string

        const cancelled = yield* tool.execute({ action: "cancel", run_id: runId }, ctx)
        expect(cancelled.output).toContain('state="cancelled"')
        expect(cancelled.metadata.action).toBe("cancel")

        // The engine settled on the terminal cancelled state ...
        const workflow = yield* Workflow.Service
        yield* pollWithTimeout(
          workflow
            .get(Workflow.RunID.make(runId))
            .pipe(Effect.map((run) => (run?.status === "cancelled" ? run : undefined))),
          "run never settled as cancelled",
        )
        // ... and no synthetic background error message was delivered to the
        // parent session (the prompt is forked, so give a stray one a moment to
        // land before asserting). The recorder also sees the engine's noReply
        // "Workflow started" notification into the run's OWN session, so the
        // assertion targets the backgroundMessage envelope, not prompt count.
        yield* Effect.sleep("300 millis")
        const backgroundMessages = recorder.prompts.filter((prompt) =>
          prompt.parts?.some(
            (part) =>
              part.type === "text" &&
              (part.text.includes("Background workflow") || part.text.includes("<workflow_run")),
          ),
        )
        expect(backgroundMessages).toEqual([])
      }),
    ),
  )

  // Item 5: pause parks the run resumable (journal kept) and the tool output
  // carries the resume instruction; a follow-up start with resume_of picks the
  // parked run up and completes.
  it.live("pause action parks the run and resume_of picks it up", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // Hangs only when args.hang is set, exactly like the resume_of test above:
        // the paused source run hangs deterministically, the resumed run settles.
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "echo",
            `export const meta = { name: "Echo", description: "Echo." }
export async function run(args, ctx) { if (args.hang) await new Promise(() => {}); return { value: args.value } }
`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const first = yield* tool.execute(
          { action: "start", name: "echo", args: { value: 1, hang: true }, background: true },
          recorder.ctx,
        )
        const sourceId = first.metadata.runId as string

        const paused = yield* tool.execute({ action: "pause", run_id: sourceId }, recorder.ctx)
        expect(paused.output).toContain('state="paused"')
        expect(paused.metadata.action).toBe("pause")
        // The resume instruction is rendered only for a genuinely paused run.
        expect(paused.output).toContain("<instructions>Resume by starting this workflow again with resume_of")

        const resumed = yield* tool.execute(
          { action: "start", name: "echo", args: { value: 1 }, resume_of: sourceId },
          recorder.ctx,
        )
        const workflow = yield* Workflow.Service
        const run = yield* workflow.get(Workflow.RunID.make(resumed.metadata.runId as string))
        expect(run?.resume_of as string | undefined).toBe(sourceId)
        expect(resumed.output).toContain(`state="completed"`)
      }),
    ),
  )

  // Item 5: a malformed run_id takes the same clean not-found path wait/inspect
  // use (Fund-7 pattern) — never the RunID schema defect through orDie.
  it.live("cancel with malformed run_id fails cleanly as not-found", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const exit = yield* Effect.exit(tool.execute({ action: "cancel", run_id: "not-a-job-id" }, recorder.ctx))
        expect(Exit.isFailure(exit)).toBe(true)
        const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
        expect(pretty).toContain("Workflow run not found: not-a-job-id")
        expect(pretty).not.toContain("isStartsWith")
      }),
    ),
  )

  // Item 5: cancel of an already-completed run is idempotent SUCCESS — the agent
  // sees the run's real terminal snapshot ("Workflow completed: …"), never an
  // error for a run that is already stopped.
  it.live("cancel of a completed run returns the snapshot idempotently", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "hello",
            `export const meta = { name: "Hello" }\nexport async function run() { return "done" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const started = yield* tool.execute({ action: "start", name: "hello" }, recorder.ctx)
        const cancelled = yield* tool.execute(
          { action: "cancel", run_id: started.metadata.runId as string },
          recorder.ctx,
        )
        expect(cancelled.title).toBe(`Workflow completed: ${started.metadata.workflow}`)
        expect(cancelled.output).toContain('state="completed"')
      }),
    ),
  )

  // background is the other LooseBoolean consumer: a stringified "true" must
  // decode without an InvalidArgumentsError (the run starts in the background).
  it.live('start tolerates background supplied as the string "true" (no InvalidArgumentsError)', () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          writeWorkflow(
            dir,
            "bg",
            `export const meta = { name: "Bg" }\nexport async function run() { return "done" }\n`,
          ),
        )
        const tool = yield* workflowTool()
        const recorder = requestRecorder()
        const result = yield* tool.execute({ action: "start", name: "bg", background: "true" }, recorder.ctx)
        // background "true" decoded to a real boolean: the run took the background path.
        expect(result.metadata.background).toBe(true)
      }),
    ),
  )
})

// Item 3: the DESCRIPTION names the explicit trigger list, the offer path with
// its cost mention, and the hybrid-scout recommendation — and mentions
// 'pipeline' (the one-line authoring doctrine).
describe("tool.workflow description hardening", () => {
  it.live("workflow tool description names triggers, offer path, and hybrid scouting", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* workflowTool()
        expect(tool.description).toContain("ultracode")
        expect(tool.description).toContain("OFFER a workflow")
        expect(tool.description).toContain("extra cost")
        expect(tool.description).toContain("discover the work list inline first")
        expect(tool.description).toContain("pipeline")
      }),
    ),
  )

  // The trigger/offer/hybrid sentences are UNCONDITIONAL: both gate variants
  // carry them (item 13 swaps only the gate sentence).
  it.effect("trigger guidance is present in both gate variants", () =>
    Effect.gen(function* () {
      for (const variant of [workflowDescription(false), workflowDescription(true)]) {
        expect(variant).toContain("OFFER a workflow")
        expect(variant).toContain("extra cost")
        expect(variant).toContain("discover the work list inline first")
        expect(variant).toContain("pipeline")
      }
    }),
  )
})

// Item 13: ultracode sessions swap ONLY the gate sentence of the workflow tool
// description ("quality over cost" instead of the anti-default rule). The swap
// happens per prompt in ToolRegistry.tools (descriptions are baked at Tool.init).
describe("tool.workflow ultracode description swap", () => {
  it.effect("workflowDescription swaps exactly the gate sentence", () =>
    Effect.gen(function* () {
      const standard = workflowDescription(false)
      const ultracode = workflowDescription(true)
      expect(standard).toContain(WORKFLOW_GATE_DEFAULT)
      expect(standard).not.toContain(WORKFLOW_GATE_ULTRACODE)
      expect(ultracode).toContain(WORKFLOW_GATE_ULTRACODE)
      expect(ultracode).toContain("quality over cost")
      expect(ultracode).not.toContain("Do not use workflows by default")
      // Everything except the gate line is identical in both variants.
      expect(standard.replace(WORKFLOW_GATE_DEFAULT, "")).toBe(ultracode.replace(WORKFLOW_GATE_ULTRACODE, ""))
    }),
  )

  it.live("ultracode flag swaps the workflow tool gate to quality over cost", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const base = { providerID: ProviderV2.ID.opencode, modelID: ModelV2.ID.make("gpt-5"), agent }
        const swapped = (yield* registry.tools({ ...base, ultracode: true })).find(
          (tool) => tool.id === WorkflowTool.id,
        )
        expect(swapped?.description).toContain("quality over cost")
        expect(swapped?.description).not.toContain("Do not use workflows by default")
        // Counter-check: without the flag the anti-default gate stays in place.
        const standard = (yield* registry.tools(base)).find((tool) => tool.id === WorkflowTool.id)
        expect(standard?.description).toContain("Do not use workflows by default")
        expect(standard?.description).not.toContain("quality over cost")
      }),
    ),
  )
})
