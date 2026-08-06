import { describe, expect } from "bun:test"
import { mkdtempSync } from "fs"
import { mkdtemp, readFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { LanguageModel } from "@opencode-ai/ai"
import * as OpenAIChat from "@opencode-ai/ai/protocols/openai-chat"
import { TestLLM } from "@opencode-ai/ai/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Model } from "@opencode-ai/core/model"
import { Permission } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { AppProcess } from "@opencode-ai/util/process"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { directoryEnvironment } from "./lib/workspace"

const FakeBinding = Schema.Struct({ root: Schema.String })

const connects = { count: 0 }

const registryLayer = Layer.effect(
  WorkspaceDriver.RegistryService,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const driver = WorkspaceDriver.make({
      create: () =>
        Effect.promise(async () => {
          const root = await mkdtemp(path.join(tmpdir(), "opencode-workspace-session-"))
          return { binding: { root }, root }
        }),
      connect: (binding) =>
        Schema.decodeUnknownEffect(FakeBinding)(binding).pipe(
          Effect.mapError((cause) => new WorkspaceDriver.Error({ provider: "fake", cause })),
          Effect.map((decoded) => {
            connects.count++
            return directoryEnvironment(decoded.root, (command) => appProcess.spawn(command))
          }),
        ),
      destroy: () => Effect.void,
    })
    return WorkspaceDriver.RegistryService.of(WorkspaceDriver.registry({ fake: driver }))
  }),
)

const registry = makeGlobalNode({
  service: WorkspaceDriver.RegistryService,
  layer: registryLayer,
  deps: [AppProcess.node],
})

// A gpt-style id so the patch plugin's context hook advertises apply_patch as
// the only editor, matching production GPT-5 sessions.
const model = LanguageModel.make({ id: "gpt-fake", provider: "fake", route: OpenAIChat.route })
const models = Layer.mock(SessionRunnerModel.Service)({
  resolve: () =>
    Effect.succeed(
      SessionRunnerModel.resolved(model, {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        cost: [],
      }),
    ),
})

// Real permission flow would ask; the runner path under test is admission
// through drain, so approve everything.
const permission = Layer.mock(Permission.Service)({ assert: () => Effect.void })

// Outer and hoisted location graphs must share one durable database, like the
// production file-backed configuration; :memory: would give each its own.
const databaseFile = path.join(mkdtempSync(path.join(tmpdir(), "opencode-workspace-session-db-")), "e2e.db")

// The real SessionExecution + Session nodes: drains route through
// LocationServiceMap.get(session.location), which is the seam under test.
// Replacements flow into every hoisted per-location graph via AppNodeBuilder.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Workspace.node,
      AppProcess.node,
      PluginRuntime.providerNode,
      LocationServiceMap.node,
      SessionExecution.node,
      Session.node,
    ]),
    [
      [Database.node, Database.configured({ path: databaseFile })],
      [WorkspaceDriver.registryNode, registry],
      [LayerNodePlatform.llmClient, TestLLM.clientLayer],
      [SessionRunnerModel.node, models],
      [Permission.node, permission],
    ],
  ).pipe(Layer.provideMerge(TestLLM.layer({ fallback: [] }))),
)

const sessionModel = Model.Ref.make({ id: Model.ID.make("gpt-fake"), providerID: Provider.ID.make("fake") })

describe("hosted workspace session", () => {
  it.live("runs a scripted model through the real runner on a hosted Location", () =>
    Effect.gen(function* () {
      const workspaces = yield* Workspace.Service
      const created = yield* workspaces.create({ provider: "fake" })

      const sessions = yield* Session.Service
      const session = yield* sessions.create({
        title: "hosted session",
        location: Location.Ref.make({
          directory: AbsolutePath.make(created.root),
          workspaceID: created.id,
        }),
        model: sessionModel,
      })

      yield* TestLLM.push(
        TestLLM.tool("call-patch", "patch", {
          patchText: "*** Begin Patch\n*** Add File: from-patch.txt\n+patched\n*** End Patch",
        }),
        TestLLM.tool("call-shell", "shell", { command: "printf 'from-model' > from-model.txt" }),
        TestLLM.tool("call-glob", "glob", { pattern: "*.txt" }),
        TestLLM.tool("call-grep", "grep", { pattern: "from-model" }),
        TestLLM.tool("call-read", "read", { path: "from-patch.txt" }),
        TestLLM.text("done", "text-1"),
      )
      yield* sessions.prompt({ sessionID: session.id, text: "Write a file in the workspace", resume: false })
      yield* sessions.resume(session.id)

      // Both tools executed inside the workspace, not on a host path.
      const written = yield* Effect.promise(() => readFile(path.join(created.root, "from-model.txt"), "utf8"))
      expect(written).toBe("from-model")
      const patched = yield* Effect.promise(() => readFile(path.join(created.root, "from-patch.txt"), "utf8"))
      expect(patched).toBe("patched\n")

      // The hosted catalog includes search tools now that they execute through
      // the Workspace process seam, plus patch as the gpt-style editor.
      const requests = (yield* TestLLM.Service).requests
      const advertised = requests[0]?.tools.map((tool) => tool.name) ?? []
      expect(advertised).toContain("shell")
      expect(advertised).toContain("patch")
      expect(advertised).toContain("glob")
      expect(advertised).toContain("grep")
      expect(advertised).toContain("read")
      expect(advertised).not.toContain("edit")
      expect(advertised).not.toContain("write")

      // Projected history shows the completed tool call and the final text.
      // Instruction updates (e.g. the Code Mode catalog settling after boot)
      // may interleave, so assert on the user and assistant messages directly.
      const context = yield* sessions.context(session.id)
      expect(context.at(0)).toMatchObject({ type: "user", text: "Write a file in the workspace" })
      const assistants = context.filter((message) => message.type === "assistant")
      expect(assistants.at(0)).toMatchObject({
        content: [{ type: "tool", id: "call-patch", state: { status: "completed" } }],
      })
      expect(assistants.at(1)).toMatchObject({
        content: [{ type: "tool", id: "call-shell", state: { status: "completed" } }],
      })
      expect(assistants.at(2)).toMatchObject({
        content: [{ type: "tool", id: "call-glob", state: { status: "completed" } }],
      })
      expect(assistants.at(3)).toMatchObject({
        content: [{ type: "tool", id: "call-grep", state: { status: "completed" } }],
      })
      expect(assistants.at(4)).toMatchObject({
        content: [{ type: "tool", id: "call-read", state: { status: "completed" } }],
      })
      expect(assistants.at(-1)).toMatchObject({ content: [{ type: "text", text: "done" }] })

      expect(connects.count).toBe(1)
    }),
  )
})
