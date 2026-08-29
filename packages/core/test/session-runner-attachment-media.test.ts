import { describe, expect } from "bun:test"
import { LLMClient, Model, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { AttachmentStore } from "@opencode-ai/core/attachment-store"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { FileAttachment, Prompt } from "@opencode-ai/core/session/prompt"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { materializeAttachments } from "@opencode-ai/core/session/runner/attachment-materialization"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { DateTime, Effect, Layer, Stream } from "effect"
import { eq } from "drizzle-orm"
import path from "path"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const sessionID = SessionV2.ID.make("ses_attachment_media")
const created = DateTime.makeUnsafe(0)
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pdf = new TextEncoder().encode("%PDF-1.7\n")
const it = testEffect(Layer.empty)

const model = (input: ReadonlyArray<string>) => ({
  model: Model.make({ id: "model", provider: "provider", route: OpenAIChat.route }),
  inputCapabilities: input,
})
const responsesModel = (input: ReadonlyArray<string>) => ({
  model: Model.make({ id: "model", provider: "provider", route: OpenAIResponses.route }),
  inputCapabilities: input,
})

const withStore = <A, E, R>(body: Effect.Effect<A, E, R | AttachmentStore.Service>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) =>
      body.pipe(
        Effect.provide(
          AttachmentStore.layerWith().pipe(
            Layer.provide(LayerNode.compile(FSUtil.node)),
            Layer.provide(Global.layerWith({ data: tmp.path })),
          ),
        ),
      ),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const upload = (store: AttachmentStore.Interface, name: string, content: Uint8Array) =>
  store.upload({
    sessionID,
    name,
    contentType: "application/octet-stream",
    content: Stream.make(content),
  })

const message = (uri: string, mime: string, name: string) =>
  SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text: "Inspect the attachment",
    files: [FileAttachment.make({ uri, mime, name })],
    time: { created },
  })

const lower = (
  store: AttachmentStore.Interface,
  selected: { readonly model: Model; readonly inputCapabilities: ReadonlyArray<string> },
  context: readonly SessionMessage.Message[],
) =>
  materializeAttachments({ store, sessionID, ...selected, context }).pipe(
    Effect.map((result) => ({ result, messages: toLLMMessages(context, selected.model, result.attachments) })),
  )

const contentTypes = (messages: ReturnType<typeof toLLMMessages>) => messages.map((item) => item.content[1]?.type)

const requests: LLMRequest[] = []
const crash = { next: false }
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (request) => {
      requests.push(request)
      if (!crash.next) return Stream.empty
      crash.next = false
      throw new Error("simulated provider process crash")
    },
    generate: () => Effect.die("unused"),
  }),
)
const selection = responsesModel(["text", "image"])
const models = SessionRunnerModel.layerWith(() => Effect.succeed(selection))
const permission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.die("unused"),
  ask: () => Effect.die("unused"),
  reply: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  forSession: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
})
const skills = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const references = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.mock(Config.Service, { entries: () => Effect.succeed([]) })
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)

const runtime = (data: string) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, AttachmentStore.node, SessionV2.node, SessionRunnerLLM.node]), [
    [Global.node, Global.layerWith({ data })],
    [Database.node, Database.layerFromPath(path.join(data, "session.db"))],
    [LayerNodePlatform.llmClient, client],
    [PermissionV2.node, permission],
    [SessionRunnerModel.node, models],
    [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    [SkillGuidance.node, skills],
    [ReferenceGuidance.node, references],
    [Snapshot.node, Snapshot.noopLayer],
    [SessionExecution.node, execution],
    [Config.node, config],
  ])

const persistedHistory = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db
    .select({ type: SessionMessageTable.type, data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, sessionID))
    .all()
    .pipe(Effect.orDie)
})

const runFirstProviderTurn = (data: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: "/project",
        title: "attachment media",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const store = yield* AttachmentStore.Service
    const info = yield* upload(store, "image.png", png)
    const session = yield* SessionV2.Service
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({
        text: "Inspect the attachment",
        files: [FileAttachment.make({ uri: info.uri, mime: info.mime, name: info.name })],
      }),
      resume: false,
    })
    const runner = yield* SessionRunner.Service
    const exit = yield* runner.run({ sessionID, force: true }).pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
    const history = yield* persistedHistory
    expect(JSON.stringify(history)).toContain(info.uri)
    expect(JSON.stringify(history)).not.toContain(Buffer.from(png).toString("base64"))
    return info
  }).pipe(Effect.provide(runtime(data)), Effect.scoped)

const runReplayProviderTurn = (data: string, info: AttachmentStore.Info) =>
  Effect.gen(function* () {
    const store = yield* AttachmentStore.Service
    expect(yield* store.resolve({ sessionID, attachmentID: info.id })).toMatchObject({
      nativeMediaDelivered: true,
    })
    const runner = yield* SessionRunner.Service
    yield* runner.run({ sessionID, force: true })
    const history = yield* persistedHistory
    expect(JSON.stringify(history)).toContain(info.uri)
    expect(JSON.stringify(history)).not.toContain(Buffer.from(png).toString("base64"))
  }).pipe(Effect.provide(runtime(data)), Effect.scoped)

const atMostOnceAcrossRestart = Effect.acquireUseRelease(
  Effect.promise(tmpdir),
  (tmp) =>
    Effect.gen(function* () {
      requests.length = 0
      crash.next = true
      const info = yield* runFirstProviderTurn(tmp.path)
      yield* runReplayProviderTurn(tmp.path, info)

      expect(requests).toHaveLength(2)
      expect(requests[0]?.messages[0]?.content[1]).toMatchObject({
        type: "media",
        mediaType: "image/png",
        data: png,
      })
      expect(requests[1]?.messages[0]?.content[1]).toMatchObject({ type: "text" })
      expect(
        requests[1]?.messages[0]?.content[1]?.type === "text" && requests[1].messages[0].content[1].text,
      ).toContain('"path":')
    }),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

describe("managed attachment media", () => {
  it.live("promotes an image only when the model accepts image input", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const info = yield* upload(store, "image.png", png)
        const input = message(info.uri, info.mime, info.name)
        const capable = yield* lower(store, model(["text", "image"]), [input])
        const incapable = yield* lower(store, model(["text"]), [input])

        expect(capable.messages[0]?.content[1]).toMatchObject({
          type: "media",
          mediaType: "image/png",
          data: png,
        })
        expect(capable.messages[0]?.content[1]?.type === "media" && capable.messages[0].content[1].filename).toBe(
          (yield* store.resolve({ sessionID, attachmentID: info.id })).path,
        )
        expect(incapable.messages[0]?.content[1]).toMatchObject({ type: "text" })
      }),
    ),
  )

  it.live("degrades MIME mismatches and unknown content to paths", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const image = yield* upload(store, "image.png", png)
        const unknown = yield* upload(store, "notes.bin", new Uint8Array([1, 2, 3]))
        const mismatched = yield* lower(store, model(["image"]), [message(image.uri, "image/jpeg", image.name)])
        const opaque = yield* lower(store, model(["image", "pdf"]), [message(unknown.uri, unknown.mime, unknown.name)])

        expect(mismatched.messages[0]?.content[1]).toMatchObject({ type: "text" })
        expect(opaque.messages[0]?.content[1]).toMatchObject({ type: "text" })
      }),
    ),
  )

  it.live("applies image and PDF capabilities independently", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const image = yield* upload(store, "image.png", png)
        const document = yield* upload(store, "document.pdf", pdf)
        const context = [
          message(image.uri, image.mime, image.name),
          message(document.uri, document.mime, document.name),
        ]
        const imageOnly = yield* lower(store, responsesModel(["image"]), context)
        const pdfOnly = yield* lower(store, responsesModel(["pdf"]), context)
        const unsafePdf = yield* lower(store, model(["pdf"]), [context[1]!])

        expect(contentTypes(imageOnly.messages)).toEqual(["media", "text"])
        expect(contentTypes(pdfOnly.messages)).toEqual(["text", "media"])
        expect(pdfOnly.messages[1]?.content[1]).toMatchObject({ type: "media", mediaType: "application/pdf" })
        expect(unsafePdf.messages[0]?.content[1]).toMatchObject({ type: "text" })
      }),
    ),
  )

  it.live("degrades media above the provider decoded limit", () =>
    withStore(
      Effect.gen(function* () {
        const store = yield* AttachmentStore.Service
        const content = new Uint8Array(20 * 1024 * 1024 + 1)
        content.set(png)
        const info = yield* upload(store, "large.png", content)
        const lowered = yield* lower(store, model(["image"]), [message(info.uri, info.mime, info.name)])

        expect(lowered.messages[0]?.content[1]).toMatchObject({ type: "text" })
        expect(lowered.result.native).toEqual([])
      }),
    ),
  )

  it.live("sends native media at most once across a store restart without persisting base64", atMostOnceAcrossRestart)
})
