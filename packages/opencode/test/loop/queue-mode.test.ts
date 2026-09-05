import { MessageV2 } from "../../src/session/message-v2"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { AutoMode } from "@/auto-mode/service"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FetchHttpClient } from "effect/unstable/http"
import { expect } from "bun:test"
import fs from "fs"
import path from "path"
import { Effect, Layer, Result } from "effect"
import { Agent as AgentSvc } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "@/env"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Loop } from "@/loop/loop"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { SessionSummary } from "@/session/summary"
import { Instruction } from "@/session/instruction"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { Skill } from "@/skill"
import { SystemPrompt } from "@/session/system"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Format } from "@/format"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in loop tests"),
    authenticate: () => Effect.die("unexpected MCP auth in loop tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in loop tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)


// Mirrors upstream's session/prompt.test.ts harness: ONE node graph compiled
// once, with mocks injected as node replacements. Building each service
// separately and merging does not work — AppNodeBuilder.build() returns a
// closed layer, so every call constructs its own Database and a session
// written through one is invisible to the others.
const runtimeFlags = RuntimeFlags.layer({ experimentalEventSystem: true })
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const loopRoot = LayerNode.group([
  Loop.node,
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  AutoMode.node,
  RuntimeFlags.node,
  SessionSummary.node,
])

function makeLoop() {
  return LayerNode.compile(loopRoot, [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ])
}

function makeHttp() {
  return LayerNode.compile(LayerNode.group([loopRoot, testLLMServerNode]), [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, runtimeFlags],
  ])
}

const it = testEffect(makeHttp())

function providerCfg(url: string): Partial<ConfigV1.Info> {
  return {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fsu = yield* FSUtil.Service
  yield* fsu.writeWithDirs(
    `${dir}/opencode.json`,
    JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }),
  )
})

function writeChange(root: string, slug: string, tasks: string) {
  const dir = path.join(root, "openspec", "changes", slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "tasks.md"), tasks)
  fs.writeFileSync(path.join(dir, "proposal.md"), `# ${slug}\n\nA fixture change.`)
  return dir
}

const waitForTerminal = (id: Loop.LoopID, seconds = 15) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const loop = yield* Loop.Service
      const info = yield* loop.get(id)
      if (!info) return undefined
      return info.status !== "running" && info.status !== "paused" ? info : undefined
    }),
    `queue loop ${id} never reached a terminal status`,
    `${seconds} seconds`,
  )

it.instance(
  "a drained queue completes immediately with a full-accounting report",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "done-change", "- [x] 1.1 already finished\n")
      const loop = yield* Loop.Service

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      expect(info.mode).toBe("queue")
      const final = yield* waitForTerminal(info.id)
      expect(final.status).toBe("completed")
      expect(final.report).toContain("queue drained")
      // Nothing was eligible, so no iterations ran and no LLM calls happened.
      expect(final.iteration).toBe(0)
      expect(yield* llm.hits).toHaveLength(0)
    }),
  { config: {} },
)

it.instance(
  "a change that never progresses is quarantined with a blocker file and the run continues",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const sickDir = writeChange(dir, "sick-change", "- [ ] 1.1 impossible task\n")
      const loop = yield* Loop.Service

      // Three implement turns that change nothing on disk → 3x gate failure.
      yield* llm.text("I looked around but did not change anything")
      yield* llm.text("I looked around but did not change anything")
      yield* llm.text("I looked around but did not change anything")

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      const final = yield* waitForTerminal(info.id, 30)

      const blocker = path.join(sickDir, ".skein", "blocker.md")
      expect(fs.existsSync(blocker)).toBe(true)
      expect(fs.readFileSync(blocker, "utf8")).toContain("implement gate failed")
      // One quarantined change is not systemic — the run drains and completes.
      expect(final.status).toBe("completed")
      expect(final.report).toContain("sick-change: quarantined")
    }),
  { config: {} },
)

it.instance(
  "a false completion claim is named in the next iteration's brief",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "claiming-change", "- [ ] 2.2 the unfinished task\n")
      const loop = yield* Loop.Service

      yield* llm.text("all done here <promise>COMPLETE</promise>")
      yield* llm.text("ok, continuing honestly")
      yield* llm.text("still nothing")

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      yield* waitForTerminal(info.id, 30)

      const hits = yield* llm.hits
      expect(hits.length).toBeGreaterThanOrEqual(2)
      const second = JSON.stringify(hits[1]?.body)
      expect(second).toContain("You signalled completion")
      expect(second).toContain("2.2")
    }),
  { config: {} },
)

it.instance(
  "a deliberate BLOCKED signal quarantines with the model's reason",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const dirChange = writeChange(dir, "blocked-change", "- [ ] 1.1 contradictory spec\n")
      const loop = yield* Loop.Service

      yield* llm.text("The spec contradicts itself, cannot proceed <promise>BLOCKED</promise>")

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      const final = yield* waitForTerminal(info.id, 30)

      const blocker = path.join(dirChange, ".skein", "blocker.md")
      expect(fs.existsSync(blocker)).toBe(true)
      expect(fs.readFileSync(blocker, "utf8")).toContain("BLOCKED")
      expect(fs.readFileSync(blocker, "utf8")).toContain("contradicts itself")
      expect(final.status).toBe("completed")
    }),
  { config: {} },
)

it.instance(
  "a second concurrent queue loop for the same directory is refused",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "busy-change", "- [ ] 1.1 will take a while\n")
      const loop = yield* Loop.Service

      // Keep the first loop alive: the provider holds its response open.
      const never = new Promise<void>(() => {})
      yield* llm.push(reply().wait(never).text("working forever").stop())

      const first = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      const second = yield* loop.create({ prompt: "", mode: "queue", interval: 0 }).pipe(Effect.result)
      expect(Result.isFailure(second)).toBe(true)
      if (Result.isFailure(second)) {
        expect(second.failure.activeLoopID).toBe(first.id)
      }
      yield* loop.cancel(first.id)
    }),
  { config: {} },
)

it.instance(
  "a failing gate spends a repair turn instead of burning strikes silently",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const changeDir = writeChange(dir, "gate-failing-change", "- [ ] 1.1 do the work\n")
      const tasksFile = path.join(changeDir, "tasks.md")
      const loop = yield* Loop.Service

      for (let i = 0; i < 8; i++) yield* llm.text("I looked at the failure and tried a fix")

      const info = yield* loop.create({
        prompt: "",
        mode: "queue",
        interval: 0,
        maxIterations: 10,
        // A test command that can never pass, so every implement->test cycle
        // must come back through a repair turn.
        queueOptions: { testCommand: "exit 1", verifyCommand: "exit 0", defaultBranch: "main" },
      })

      // Stand in for the agent finishing the work: once its first turn has
      // reached the provider, check the task off so the implement gate passes
      // and the failing test gate becomes reachable.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const hits = yield* llm.hits
          return hits.length > 0 ? true : undefined
        }),
        "first implement turn never reached the provider",
        "10 seconds",
      )
      fs.writeFileSync(tasksFile, "- [x] 1.1 do the work\n")

      const final = yield* waitForTerminal(info.id, 40)

      // A test gate that never passes once is treated as misconfiguration and
      // halts the run, rather than quarantining changes one at a time against a
      // broken command and blockering the whole backlog.
      expect(final.status).toBe("error")
      expect(final.report).toContain("suspected misconfigured test gate")
      // Crucially the change is left CLEAN: a config mistake must not blocker
      // work that may well be finished. No blocker file survives the halt.
      expect(fs.existsSync(path.join(changeDir, ".skein", "blocker.md"))).toBe(false)
      expect(final.report).toContain("was NOT quarantined")
      // Each failure still spent a real repair turn carrying the gate's failure
      // output to the model, rather than re-passing the checkbox gate and
      // burning strikes in a tight loop with no model involvement.
      const hits = yield* llm.hits
      const withFailure = hits.map((h) => JSON.stringify(h.body)).filter((b) => b.includes("TEST gate failed"))
      expect(withFailure.length).toBeGreaterThanOrEqual(2)
    }),
  { config: {} },
)

it.instance(
  "gate commands come from experimental.queue_gate so the TUI needs no flags",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      const marker = path.join(dir, "gate-ran-here.txt")
      // The whole point of the config layer: a bare `/loop --queue` from the
      // TUI must pick these up, because typing gate flags into a prompt box
      // every time is not a workflow.
      yield* writeConfig(dir, {
        ...providerCfg(llm.url),
        experimental: {
          queue_gate: {
            // Relative on purpose: a config path must resolve against the repo,
            // not the server process's cwd. "." is the repo root here.
            cwd: ".",
            // Records that it ran, then fails — enough to prove which command
            // was used without needing a real test suite.
            test_command: `pwd > ${marker}; exit 1`,
            verify_command: "exit 0",
            default_branch: "main",
          },
        },
      })
      const changeDir = writeChange(dir, "config-gate-change", "- [ ] 1.1 do the work\n")
      const loop = yield* Loop.Service

      for (let i = 0; i < 8; i++) yield* llm.text("working on it")

      // No queueOptions at all — exactly what the palette command sends.
      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0, maxIterations: 10 })

      yield* pollWithTimeout(
        Effect.gen(function* () {
          const hits = yield* llm.hits
          return hits.length > 0 ? true : undefined
        }),
        "first implement turn never reached the provider",
        "10 seconds",
      )
      fs.writeFileSync(path.join(changeDir, "tasks.md"), "- [x] 1.1 do the work\n")

      const final = yield* waitForTerminal(info.id, 40)

      // The configured test command ran, in the configured directory.
      expect(fs.existsSync(marker)).toBe(true)
      expect(fs.readFileSync(marker, "utf8")).toContain(dir.replace(/\/$/, "").split("/").pop()!)
      // And because it never passes, the misconfiguration halt still protects
      // the change rather than blockering it.
      expect(final.status).toBe("error")
      expect(fs.existsSync(path.join(changeDir, ".skein", "blocker.md"))).toBe(false)
    }),
  { config: {} },
)

it.instance(
  "the work runs in your session, and the ceiling is applied then handed back",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "visible-change", "- [ ] 1.1 work\n")
      const loop = yield* Loop.Service
      const session = yield* Session.Service

      const mine = yield* session.create({ title: "my session" })
      expect((yield* session.get(mine.id)).permission ?? []).toHaveLength(0)
      for (let i = 0; i < 8; i++) yield* llm.text("looking at it")

      const info = yield* loop.create({
        prompt: "",
        mode: "queue",
        sessionID: mine.id,
        interval: 0,
        maxIterations: 3,
        queueOptions: { testCommand: "exit 0", verifyCommand: "exit 0", defaultBranch: "main" },
      })

      // While it runs, the session you are watching carries the ceiling — that
      // ruleset is what denies pushing and what keeps the run from stopping to
      // ask, and it has to be on the session the work actually runs in.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* session.get(mine.id)
          return current.permission?.some((rule) => rule.action === "deny" && rule.pattern.includes("push"))
            ? true
            : undefined
        }),
        "the ceiling was never applied to the running session",
        "10 seconds",
      )

      const final = yield* waitForTerminal(info.id, 40)
      expect(final.iterations.every((item) => item.sessionID === mine.id)).toBe(true)

      // ...and it is handed back when the run ends, however it ended.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* session.get(mine.id)
          return (current.permission ?? []).length === 0 ? true : undefined
        }),
        "the ceiling was left behind on the session after the run",
        "10 seconds",
      )
    }),
  { config: {} },
)

// --- persona-bound gates -----------------------------------------------------

// Deliberately declares itself allowed to do everything. A gate subagent's
// ceiling must not depend on its persona file being right — config directories
// merge with ~/.opencode last, so a globally seeded persona overrides a
// project's own, and only ever toward more permission.
const PERMISSIVE_REVIEWER = {
  mode: "subagent" as const,
  description: "A reviewer whose own definition grants it everything",
  prompt: "Review the work and return LGTM or NEEDS_WORK.",
  permission: { write: "allow" as const, edit: "allow" as const, bash: "allow" as const },
}

const REVIEWER = {
  mode: "subagent" as const,
  description: "Reads finished work and returns a verdict",
  prompt: "Review the work and return LGTM or NEEDS_WORK.",
  permission: { write: "deny" as const, edit: "deny" as const },
}

it.instance(
  "a gate bound to an agent that does not exist halts the run before anything is attempted",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, {
        ...providerCfg(llm.url),
        experimental: { queue_personas: { verify: "nobody" } },
      })
      writeChange(dir, "unstarted-change", "- [ ] 1.1 work\n")
      const loop = yield* Loop.Service

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      const final = yield* waitForTerminal(info.id, 20)

      // A review gate that quietly stops reviewing is worse than one that
      // refuses to start: the run would keep advancing toward commit.
      expect(final.status).toBe("error")
      expect(final.report).toContain("nobody")
      expect(final.report).toContain("nothing was attempted")
      expect(yield* llm.hits).toHaveLength(0)
    }),
  { config: {} },
)

it.instance(
  "a NEEDS_WORK verdict fails the verify gate and its findings reach the repair brief",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, { ...providerCfg(llm.url), agent: { reviewer: REVIEWER } })
      const changeDir = writeChange(dir, "reviewed-change", "- [ ] 1.1 the work\n")
      const tasksFile = path.join(changeDir, "tasks.md")
      const loop = yield* Loop.Service

      // The first turn actually does the work — a change is only eligible while
      // a box is unchecked, so the queue cannot reach `verify` without one
      // turn that checks it.
      yield* llm.tool("write", { filePath: tasksFile, content: "- [x] 1.1 the work\n" })
      yield* llm.text("implemented")
      // Everything after that — reviewer verdicts and repair turns alike —
      // says NEEDS_WORK, so verify strikes out and the change is quarantined.
      for (let i = 0; i < 12; i++) yield* llm.text("Findings: the ceiling leaks on throw.\n\nVerdict: NEEDS_WORK")

      const info = yield* loop.create({
        prompt: "",
        mode: "queue",
        interval: 0,
        maxIterations: 12,
        queueOptions: { testCommand: "exit 0", verifyCommand: "exit 0", defaultBranch: "main" },
      })
      const final = yield* waitForTerminal(info.id, 90)

      expect(final.report).toContain("reviewed-change: quarantined")
      expect(final.report).toContain("gate reached: verify")

      // The verdict text has to reach a repair turn, or the model is being
      // asked to fix something it was never told about.
      const bodies = (yield* llm.hits).map((hit) => JSON.stringify(hit.body)).join("\n")
      expect(bodies).toContain("the ceiling leaks on throw")

      // An agent gate that keeps saying no is doing its job — it must not be
      // mistaken for the misconfigured-command case, which un-quarantines.
      expect(final.report).not.toContain("suspected misconfigured")
    }),
  { config: {} },
)

it.instance(
  "the review subagent is fenced even when its own persona grants it everything",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, { ...providerCfg(llm.url), agent: { reviewer: PERMISSIVE_REVIEWER } })
      const changeDir = writeChange(dir, "judged-change", "- [ ] 1.1 the work\n")
      const loop = yield* Loop.Service
      const session = yield* Session.Service

      yield* llm.tool("write", { filePath: path.join(changeDir, "tasks.md"), content: "- [x] 1.1 the work\n" })
      yield* llm.text("implemented")
      for (let i = 0; i < 12; i++) yield* llm.text("Verdict: NEEDS_WORK")

      const info = yield* loop.create({
        prompt: "",
        mode: "queue",
        interval: 0,
        maxIterations: 12,
        queueOptions: { testCommand: "exit 0", verifyCommand: "exit 0", defaultBranch: "main" },
      })

      const reviewSession = yield* pollWithTimeout(
        Effect.gen(function* () {
          const current = yield* loop.get(info.id)
          if (!current) return undefined
          const kids = yield* session.children(current.sessionID)
          return kids.find((kid) => kid.title.startsWith("verify: reviewer"))
        }),
        "the reviewer never got its own session",
        "60 seconds",
      )

      // Evaluated, not merely present: the persona's own rules are in here too
      // and a stray allow later in the list would beat an earlier deny.
      const rules = reviewSession.permission ?? []
      for (const permission of ["bash", "write", "edit", "patch", "apply_patch"]) {
        expect(Permission.evaluate(permission, "*", rules).action, permission).toBe("deny")
      }

      yield* loop.cancel(info.id).pipe(Effect.ignore)
      yield* waitForTerminal(info.id, 30)
    }),
  { config: {} },
)

it.instance(
  "a completed change is pushed, and the report says which branch",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, { ...providerCfg(llm.url), agent: { reviewer: REVIEWER } })
      const changeDir = writeChange(dir, "shipped-change", "- [ ] 1.1 the work\n")

      // A bare repo standing in for origin, so the push is real rather than
      // mocked — the point of this test is that the command actually works.
      const origin = path.join(path.dirname(dir), `${path.basename(dir)}-origin.git`)
      const sh = (command: string) =>
        Effect.promise(() => Bun.$`bash -lc ${command}`.cwd(dir).quiet().nothrow().text())
      yield* sh(`git init -q --bare ${origin}`)
      yield* sh("git init -q")
      yield* sh("git config user.email t@t.t")
      yield* sh("git config user.name t")
      yield* sh("git add -A")
      yield* sh("git commit -q -m init")
      yield* sh(`git remote add origin ${origin}`)
      yield* sh("git checkout -q -b loop/shipped-change")

      const loop = yield* Loop.Service
      // One implement turn that checks the box AND commits, so the commit gate
      // passes on its first evaluation. The scripted LLM is a single FIFO shared
      // by every session in the run, so the fewer turns, the less brittle.
      yield* llm.tool("write", { filePath: path.join(changeDir, "tasks.md"), content: "- [x] 1.1 the work\n" })
      yield* llm.tool("bash", {
        command: `git add -A && git commit -q -m "feat: shipped-change"`,
        description: "commit the change",
      })
      yield* llm.text("implemented and committed")
      for (let i = 0; i < 6; i++) yield* llm.text("Verdict: LGTM")

      const info = yield* loop.create({
        prompt: "",
        mode: "queue",
        interval: 0,
        maxIterations: 12,
        queueOptions: { testCommand: "exit 0", verifyCommand: "exit 0", defaultBranch: "main" },
      })
      const final = yield* waitForTerminal(info.id, 120)

      expect(final.report).toContain("shipped-change: completed")
      expect(final.report).toContain("Pushed:")
      expect(final.report).toContain("pushed loop/shipped-change")

      // The branch is really on the remote, not just claimed in a report.
      const remote = yield* sh(`git --git-dir=${origin} branch --list`)
      expect(remote).toContain("loop/shipped-change")
      expect(remote).not.toContain("main")
    }),
  { config: {} },
)

it.instance(
  "--no-push leaves the commits local and says so",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "held-change", "- [x] 1.1 done\n")
      const loop = yield* Loop.Service

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0, queuePush: false })
      const final = yield* waitForTerminal(info.id, 30)
      expect(final.report).toContain("Push disabled")
    }),
  { config: {} },
)

// --- steering a live run ---------------------------------------------------

it.instance(
  "a correction reaches the run and keeps reaching it",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      const loop = yield* Loop.Service

      // Varied output, and the no-progress guard disabled: identical replies
      // would trip it and end the run before "and the one after" is observable.
      for (let i = 0; i < 20; i++) yield* llm.text(`working on step ${i} of the thing`)

      // Prompt mode: it keeps iterating to `max` rather than quarantining after
      // three gate failures, which is what makes "and the one after" observable.
      const info = yield* loop.create({ prompt: "do the thing", interval: 0, maxIterations: 8, noProgressLimit: 0 })

      yield* pollWithTimeout(
        Effect.map(loop.get(info.id), (current) => (current && current.iteration >= 1 ? true : undefined)),
        "the run never produced an iteration",
        "30 seconds",
      )
      expect(yield* loop.nudge(info.id, "leave the CLI alone")).toBe(true)

      const bodies = () => Effect.map(llm.hits, (hits) => hits.map((hit) => JSON.stringify(hit.body)))
      const carrying = () => Effect.map(bodies(), (all) => all.filter((body) => body.includes("leave the CLI alone")))

      // Not "the next prompt": the iteration already in flight when the
      // correction arrived is deliberately not interrupted, so the first
      // delivery may be one turn later. What matters is that it arrives...
      yield* pollWithTimeout(
        Effect.map(carrying(), (hits) => (hits.length >= 1 ? true : undefined)),
        "the correction never reached the run",
        "120 seconds",
      )
      // ...and that it keeps arriving. An instruction given once must not be
      // forgotten on the iteration after — that is the whole difference between
      // steering a run and shouting at it.
      // Twice is the whole claim: delivered, then delivered again on a later
      // iteration. Requiring more only makes the test hostage to how many
      // iterations get scheduled while the rest of the suite is running.
      yield* pollWithTimeout(
        Effect.map(carrying(), (hits) => (hits.length >= 2 ? true : undefined)),
        "the correction was delivered once and then forgotten",
        "120 seconds",
      )

      yield* loop.cancel(info.id).pipe(Effect.ignore)
      yield* waitForTerminal(info.id, 30)

      // The user's own prompt survives alongside it, rather than being replaced.
      const withBoth = (yield* carrying()).filter((body) => body.includes("do the thing"))
      expect(withBoth.length).toBeGreaterThan(0)
    }),
  { config: {} },
)

it.instance(
  "steering a finished loop is refused, and an empty correction is not recorded",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "done-already", "- [x] 1.1 finished\n")
      const loop = yield* Loop.Service

      const info = yield* loop.create({ prompt: "", mode: "queue", interval: 0 })
      const final = yield* waitForTerminal(info.id, 30)
      expect(final.status).toBe("completed")

      expect(yield* loop.nudge(info.id, "too late")).toBe(false)
      expect(yield* loop.nudge("loop_doesnotexist" as Loop.LoopID, "nobody")).toBe(false)
    }),
  { config: {} },
)

// loop-eternal-by-default
it.instance(
  "a completed prompt-mode loop continues into backlog work instead of stopping",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "eternal-fixture-change", "- [ ] 1.1 something still planned\n")
      const loop = yield* Loop.Service

      // Iteration 1: the loop's own prompt completes.
      yield* llm.text("done with the requested task <promise>COMPLETE</promise>")
      // Transition: queue-mode implement turns that never touch the fixture's
      // tasks.md, so the change quarantines after 3 consecutive failures
      // (same shape as the "sick-change" quarantine test above) — the queue
      // then drains with nothing else eligible, giving a deterministic
      // terminal state to assert on.
      yield* llm.text("I looked around but did not change anything")
      yield* llm.text("I looked around but did not change anything")
      yield* llm.text("I looked around but did not change anything")

      const info = yield* loop.create({ prompt: "finish the quick task", maxIterations: 10, interval: 0 })
      expect(info.mode).toBe("prompt")
      expect(info.eternal).toBe(true)

      const final = yield* waitForTerminal(info.id, 30)

      // Not "completed" after one iteration and stopped — the backlog had
      // planned work, so the loop kept going as a queue run.
      expect(final.mode).toBe("queue")
      expect(final.status).toBe("completed")
      expect(final.report).toContain("eternal-fixture-change: quarantined")
    }),
  { config: {} },
)

it.instance(
  "eternal: false stops a completed prompt-mode loop even with backlog work pending",
  () =>
    Effect.gen(function* () {
      const { directory: dir } = yield* TestInstance
      const llm = yield* TestLLMServer
      yield* writeConfig(dir, providerCfg(llm.url))
      writeChange(dir, "ignored-fixture-change", "- [ ] 1.1 something still planned\n")
      const loop = yield* Loop.Service

      yield* llm.text("done with the requested task <promise>COMPLETE</promise>")

      const info = yield* loop.create({
        prompt: "finish the quick task",
        maxIterations: 10,
        interval: 0,
        eternal: false,
      })
      const final = yield* waitForTerminal(info.id, 15)

      expect(final.mode).toBe("prompt")
      expect(final.status).toBe("completed")
      // No queue turn was ever attempted — exactly the one canned response.
      expect(yield* llm.hits).toHaveLength(1)
    }),
  { config: {} },
)
