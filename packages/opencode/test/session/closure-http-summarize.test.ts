import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionMutation } from "@/session/closure/mutation"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionID } from "@/session/schema"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { disposeAllInstances, provideInstance, TestInstance } from "../fixture/fixture"
import { unusedJobs } from "../lib/closure"
import { testEffect } from "../lib/effect"
import { isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import {
  closureRecord,
  multipartPartial,
  ordinaryUser,
  persistHistoricalMessage,
  wrongTextLookalike,
} from "../lib/closure-record"

const trace: string[] = []
const compactAgents: string[] = []
let refused: SessionID | undefined
let sequence = 0
let routedDatabase: Database.Interface | undefined

const closureService = SessionClosure.Service.of({
  ...unusedJobs,
  request: () => Effect.die("unused request"),
  view: Effect.die("unused view"),
  identity: Effect.die("unused identity"),
  acquire: (input) =>
    Effect.sync(() => {
      trace.push(`acquire:${input.session}:${input.source}`)
      if (input.session === refused) {
        return {
          type: "fenced" as const,
          state: "closing" as const,
          operation: Model.id("operation", "operation_k38_refused"),
          epoch: 0n,
        }
      }
      sequence += 1
      return {
        type: "admitted" as const,
        lease: Model.id("lease", `lease_k38_${sequence}`),
        epoch: 0n,
        instance: Model.id("instance", "instance_k38"),
      }
    }),
  bind: () => Effect.void,
  retire: () => Effect.sync(() => void trace.push("retire")),
  reserveMutation: (input) =>
    Effect.sync(() => {
      trace.push(`mutation:reserve:${input.sessions.join(",")}:${input.kind}`)
      return { type: "reserved" as const, mutation: Model.id("mutation", "mutation_k38") }
    }),
  activateMutation: () => Effect.sync(() => void trace.push("mutation:active")),
  retireMutation: () => Effect.sync(() => void trace.push("mutation:retire")),
})
const closure = Layer.succeed(SessionClosure.Service, closureService)

const revert = Layer.succeed(
  SessionRevert.Service,
  SessionRevert.Service.of({
    revert: () => Effect.die("unused revert"),
    unrevert: () => Effect.die("unused unrevert"),
    cleanup: (session) =>
      SessionMutation.leased(
        closureService,
        { sessions: [session.id], kind: "revert_cleanup" },
        Effect.sync(() => void trace.push("cleanup")),
      ),
  }),
)

const compact = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    isOverflow: () => Effect.die("unused isOverflow"),
    prune: () => Effect.die("unused prune"),
    process: () => Effect.die("unused process"),
    create: (input) =>
      Effect.sync(() => {
        compactAgents.push(input.agent)
        trace.push("compact")
      }),
  }),
)

const reply = { info: { id: "msg_k38" }, parts: [] } as unknown as SessionV1.WithParts
const prompt = Layer.succeed(
  SessionPrompt.Service,
  SessionPrompt.Service.of({
    cancel: () => Effect.void,
    prompt: () => Effect.die("unused prompt"),
    loop: () => Effect.sync(() => trace.push("loop")).pipe(Effect.as(reply)),
    shell: () => Effect.die("unused shell"),
    command: () => Effect.die("unused command"),
    resolvePromptParts: () => Effect.die("unused resolvePromptParts"),
  }),
)

const database = Layer.effect(
  Database.Service,
  Effect.gen(function* () {
    const service = yield* Database.Service
    routedDatabase = service
    return service
  }),
).pipe(Layer.provide(LayerNode.compile(Database.node)))

const replacements = [
  [Database.node, database],
  [SessionClosure.node, closure],
  [SessionRevert.node, revert],
  [SessionCompaction.node, compact],
  [SessionPrompt.node, prompt],
] as const satisfies LayerNode.Replacements
const served: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, replacements),
  { disableListenLog: true, disableLogger: true },
)
const http = served.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(http, LayerNode.compile(Session.node)))

const request = (path: string, directory: string, init: RequestInit = {}) => {
  const url = new URL(path, "http://localhost")
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return HttpClientRequest.fromWeb(new Request(url, { ...init, headers })).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

afterEach(async () => {
  refused = undefined
  trace.length = 0
  compactAgents.length = 0
  routedDatabase = undefined
  await disposeAllInstances()
})

describe("summarize handler closure admission (CP-023 K38)", () => {
  it.instance(
    "takes the combined lease before cleanup and stops at admission when refused",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "content-type": "application/json" }
        const create = () =>
          request("/session", test.directory, { method: "POST", headers }).pipe(
            Effect.flatMap((response) => response.json),
            Effect.map((value) => value as { id: SessionID }),
          )
        const summarize = (session: SessionID) =>
          request(`/session/${session}/summarize`, test.directory, {
            method: "POST",
            headers,
            body: JSON.stringify({ providerID: "provider", modelID: "model" }),
          })

        const admitted = yield* create()
        trace.length = 0
        const success = yield* summarize(admitted.id)
        expect(success.status).toBe(200)
        expect(trace).toEqual([
          `acquire:${admitted.id}:SessionHttpApi.summarize`,
          `mutation:reserve:${admitted.id}:revert_cleanup`,
          "mutation:active",
          "cleanup",
          "mutation:retire",
          "compact",
          "loop",
          "retire",
        ])

        const blocked = yield* create()
        refused = blocked.id
        trace.length = 0
        const failure = yield* summarize(blocked.id)
        expect(failure.status).toBe(409)
        expect(trace).toEqual([`acquire:${blocked.id}:SessionHttpApi.summarize`])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "selects the latest non-closure agent while malformed synthetic rows remain conversational",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "content-type": "application/json" }
        const create = () =>
          request("/session", test.directory, { method: "POST", headers }).pipe(
            Effect.flatMap((response) => response.json),
            Effect.map((value) => value as { id: SessionID }),
          )
        const summarize = (session: SessionID) =>
          request(`/session/${session}/summarize`, test.directory, {
            method: "POST",
            headers,
            body: JSON.stringify({ providerID: "provider", modelID: "model" }),
          })
        const persist = (message: SessionV1.WithParts) =>
          provideInstance(test.directory)(
            Effect.suspend(() => {
              if (!routedDatabase) return Effect.die("HTTP Database layer was not captured")
              return persistHistoricalMessage(message).pipe(
                Effect.provideService(Database.Service, routedDatabase),
                Effect.asVoid,
              )
            }),
          )

        const control = yield* create()
        const controlUser = ordinaryUser({
          sessionID: control.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "control-agent",
        })
        yield* persist(controlUser)
        expect((yield* summarize(control.id)).status).toBe(200)
        expect(compactAgents.at(-1)).toBe("control-agent")

        const target = yield* create()
        const ordinary = ordinaryUser({
          sessionID: target.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "ordinary-agent",
        })
        const synthetic = ordinaryUser({
          sessionID: target.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "synthetic-agent",
          synthetic: true,
        })
        const lookalike = wrongTextLookalike({
          sessionID: target.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "lookalike-agent",
        })
        const partial = multipartPartial({
          sessionID: target.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "partial-agent",
        })
        const closure = closureRecord({
          sessionID: target.id,
          messageID: MessageID.ascending(),
          partID: PartID.ascending(),
          agent: "closure-agent",
        })
        expect(isCompleteClosurePair(closure)).toBe(true)
        expect([ordinary, synthetic, lookalike, partial].map(isCompleteClosurePair)).toEqual([
          false,
          false,
          false,
          false,
        ])
        for (const message of [ordinary, synthetic, lookalike, partial, closure]) yield* persist(message)

        expect((yield* summarize(target.id)).status).toBe(200)
        expect(compactAgents.at(-1)).toBe("partial-agent")
        expect(compactAgents.at(-1)).not.toBe("closure-agent")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
