import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { Database } from "@opencode/core/database/database"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { Flag } from "@opencode/core/flag"
import { Image } from "@opencode/core/image"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Session } from "@opencode/core/session"
import { SessionBlob } from "@opencode/core/session/blob"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { BlobTable, SessionMessageTable } from "@opencode/core/session/sql"
import { SessionStored } from "@opencode/core/session/stored"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { LanguageModel, LLMClient } from "../../ai/src/effect"
import { OpenAIChat } from "../../ai/src/protocols/openai-chat"
import { TestLLM } from "../../ai/src/testing"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { imagePassthrough } from "../../core/test/lib/image"
import { createEmbeddedRoutes } from "../src/routes"

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const pngHash = SessionBlob.hashBytes(Buffer.from(pngBase64, "base64"))

const runChannel = (channel: "dev" | "latest") =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped(`opencode-flag-channel-${channel}-`)
    const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
    const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "flag-channel-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [],
        limit: { context: 200_000, output: 8_192 },
      },
    )

    let conversions = 0
    const context = yield* Layer.build(
      createEmbeddedRoutes(
        {
          app: { channel, version: "test" },
          database: { path: ":memory:" },
          config: { project: false, claude: false },
          models: { fetch: false, snapshot: false },
          fs: { filewatcher: false, fff: false },
        },
        [
          Global.node.replace(tempGlobalLayer),
          llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
          SessionRunnerModel.node.replace(
            Layer.succeed(SessionRunnerModel.Service, { resolve: () => Effect.succeed(model) }),
          ),
          Image.node.replace(imagePassthrough),
        ],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )

    const sessions = Context.get(context, Session.Service)
    const locations = Context.get(context, LocationServiceMap.Service)
    const { db } = Context.get(context, Database.Service)
    expect(Context.get(context, App.Service)).toEqual({ name: "opencode", version: "test", channel })

    const session = yield* sessions.create({
      title: `channel-${channel}`,
      agent: Agent.ID.make("build"),
      model: model.ref,
      location,
    })

    // Pre-warm Tool.snapshot() after MCP tools settle so the legacy catalog runtime is already cached on the inventory;
    // a conversion during the session step's execute call then happens if and only if the VM runtime is built and run.
    yield* Effect.gen(function* () {
      expect(yield* App.Service).toEqual({ name: "opencode", version: "test", channel })
      yield* Plugin.awaitActivation
      const mcp = yield* McpTool.Service
      yield* mcp.flush
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        }),
      )
      const tools = yield* Tool.Service
      yield* tools.transform((editor) =>
        editor.add({
          name: "probe",
          description: "Probe Code Mode engine",
          input: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: (value: unknown) => ({ value }),
              jsonSchema: {
                input: () => {
                  conversions++
                  return { type: "object", properties: { value: { type: "string" } }, required: ["value"] }
                },
                output: () => ({}),
              },
            },
          },
          execute: (input) => Effect.succeed({ content: (input as { value: string }).value }),
        }),
      )
      conversions = 0
    }).pipe(Effect.provide(locations.get(session.location)))

    yield* llm.push(
      TestLLM.toolCall("call_execute", "execute", { code: "return 1 + 1" }),
      TestLLM.text("done", "text_1"),
    )

    const admitted = yield* sessions.prompt({
      sessionID: session.id,
      text: "run probe",
      files: [{ uri: `data:image/png;base64,${pngBase64}`, name: "shot.png" }],
    })
    yield* sessions.wait(session.id)

    const blobs = yield* db
      .select({ hash: BlobTable.hash })
      .from(BlobTable)
      .all()
      .pipe(Effect.orDie)
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .all()
      .pipe(Effect.orDie)
    const userRow = rows.find((row) => row.id === admitted.id)

    return {
      engine: conversions === 2 ? ("vm" as const) : ("legacy" as const),
      blobs,
      userFiles: userRow && "files" in userRow.data ? userRow.data.files : undefined,
    }
  }).pipe(Effect.provideService(Flag.Overrides, undefined), Effect.scoped)

it.live("enables codemode_vm and media_blob by default on dev builds", () =>
  Effect.gen(function* () {
    expect(yield* runChannel("dev")).toEqual({
      engine: "vm",
      blobs: [{ hash: pngHash }],
      userFiles: [{ uri: SessionStored.ref(pngHash), mime: "image/png", name: "shot.png", source: { type: "inline" } }],
    })
  }),
)

it.live("keeps codemode_vm and media_blob off by default on latest builds", () =>
  Effect.gen(function* () {
    expect(yield* runChannel("latest")).toEqual({
      engine: "legacy",
      blobs: [],
      userFiles: [{ data: pngBase64, mime: "image/png", name: "shot.png", source: { type: "inline" } }],
    })
  }),
)
