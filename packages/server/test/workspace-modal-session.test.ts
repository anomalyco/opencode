import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "fs"
import { homedir, tmpdir } from "os"
import path from "path"
import { Effect, Layer } from "effect"
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
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { Workspace } from "@opencode-ai/core/workspace"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ServerWorkspaceDrivers } from "../src/workspace/drivers"
import { ModalDriver } from "../src/workspace/modal"

const hasCredentials = process.env.MODAL_TOKEN_ID !== undefined || existsSync(path.join(homedir(), ".modal.toml"))

const databaseFile = path.join(mkdtempSync(path.join(tmpdir(), "opencode-modal-session-")), "session.db")

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

const permission = Layer.mock(Permission.Service)({ assert: () => Effect.void })

const layer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    Bus.node,
    Workspace.node,
    PluginRuntime.providerNode,
    LocationServiceMap.node,
    SessionExecution.node,
    Session.node,
  ]),
  [
    [Database.node, Database.configured({ path: databaseFile })],
    [WorkspaceDriver.registryNode, ServerWorkspaceDrivers.node],
    [LayerNodePlatform.llmClient, TestLLM.clientLayer],
    [SessionRunnerModel.node, models],
    [Permission.node, permission],
  ],
).pipe(Layer.provideMerge(TestLLM.layer({ fallback: [] })))

const sessionModel = Model.Ref.make({ id: Model.ID.make("gpt-fake"), providerID: Provider.ID.make("fake") })

// A scripted model through the real runner against a real Modal sandbox: the
// session-level counterpart of workspace-modal-graph.test.ts.
describe.skipIf(!hasCredentials)("hosted session on modal (live)", () => {
  test(
    "runs a scripted model through the real runner on a modal sandbox",
    async () => {
      await Effect.gen(function* () {
        const workspaces = yield* Workspace.Service
        const created = yield* workspaces.create({ provider: "modal" })
        const driver = yield* ModalDriver.make
        const found = yield* workspaces.binding(created.id)
        yield* Effect.addFinalizer(() => Effect.ignore(driver.destroy(found.binding)))

        const sessions = yield* Session.Service
        const location = Location.Ref.make({
          directory: AbsolutePath.make(created.root),
          workspaceID: created.id,
        })
        const session = yield* sessions.create({
          title: "hosted modal session",
          location,
          model: sessionModel,
        })

        yield* TestLLM.push(
          TestLLM.tool("call-patch", "patch", {
            patchText: "*** Begin Patch\n*** Add File: from-patch.txt\n+patched\n*** End Patch",
          }),
          TestLLM.tool("call-shell", "shell", { command: "printf 'from-model' > from-model.txt" }),
          TestLLM.tool("call-glob", "glob", { pattern: "*.txt" }),
          TestLLM.tool("call-grep", "grep", { pattern: "from-model" }),
          // Read must go through the sandbox filesystem: the host has no
          // /workspace/from-patch.txt, so a host-backed reader would fail.
          TestLLM.tool("call-read", "read", { path: "from-patch.txt" }),
          TestLLM.text("done", "text-1"),
        )
        yield* sessions.prompt({ sessionID: session.id, text: "Write a file in the workspace", resume: false })
        yield* sessions.resume(session.id)

        const requests = (yield* TestLLM.Service).requests
        const advertised = requests[0]?.tools.map((tool) => tool.name) ?? []
        expect(advertised).toContain("shell")
        expect(advertised).toContain("patch")
        expect(advertised).toContain("glob")
        expect(advertised).toContain("grep")
        expect(advertised).toContain("read")
        expect(advertised).not.toContain("edit")
        expect(advertised).not.toContain("write")

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

        // Both tools executed inside the sandbox: read the files back through
        // the hosted filesystem rather than any host path.
        const locations = yield* LocationServiceMap.Service
        yield* Effect.gen(function* () {
          const filesystem = yield* FileSystem.Service
          const written = yield* filesystem.read({ path: RelativePath.make("from-model.txt") })
          expect(new TextDecoder().decode(written.content)).toBe("from-model")
          const patched = yield* filesystem.read({ path: RelativePath.make("from-patch.txt") })
          expect(new TextDecoder().decode(patched.content)).toBe("patched\n")
        }).pipe(Effect.provide(locations.get(location)))
      }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)
    },
    { timeout: 600_000 },
  )
})
