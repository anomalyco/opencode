import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Deferred, Effect, Fiber, Layer, Queue } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { SessionCompaction } from "@/session/compaction"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionID } from "@/session/schema"
import { SessionToolPartPermit } from "@/session/toolpart-permit"
import { HttpApiApp } from "@/server/routes/instance/httpapi/server"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// CP-023 §17.2 K55, against a REAL fence.
//
// K55 requires that "fence at every boundary proves no deletion, compaction, loop, or provider
// starts prematurely". Every other fence in this area is SCRIPTED at the coordinator's `acquire`
// answer — closure-http-summarize.test.ts hands back a literal `{ type: "fenced" }`. That tests the
// seam's RESPONSE to a refusal; it does not test that a fence ARISES correctly through the real
// mechanism, and the two are not the same thing (see the note on join-vs-refuse below).
//
// Slice M deferred this as Gate-4 work on the grounds that production `Ports.layer` ships a no-op
// driver, so no real fence could be raised. That was wrong as stated: `Ports.makeLayer` accepts a
// driver, `closure-revert-mutation.test.ts:72` has raised real fences this way since well before
// Gate 3, and `LayerNodeTree.compile` substitution reaches the Ports node. The mechanism existed
// all along. What this file adds is that it reaches through the HTTP graph too.
//
// WHAT A REAL FENCE DOES HERE, AND WHY IT IS NOT A REFUSAL. `SessionHttpApi.summarize` admits with
// `origin: "external"`, so §7.2's join-then-retry applies: a fenced external admission JOINS and
// waits for physical/logical closure and fence release before retrying. It does not refuse. Fence
// RELEASE runs through the operation phase machinery (quiescence -> planning -> recording ->
// release.commit) that Gate 4 owns; `planning.return` constructs the frozen generation and enters
// recording atomically. This is the same limit the manifest already records against
// `coordinator-release-never-wakes`. So the observable at Gate 3 is that the request PARKS having
// done nothing — which is precisely K55's criterion. The scripted fence and the real one therefore
// produce different outcomes for this seam (500 vs park), and only the real one reflects production.

type HeldRun = { readonly input: Ports.DriverRun; readonly release: Deferred.Deferred<void> }

const runs: { queue?: Queue.Queue<HeldRun> } = {}
const captured: { closure?: SessionClosure.Interface } = {}
const trace: string[] = []

const capability: Ports.RunStateCapability = {
  assertNotBusy: () => Effect.void,
  cancel: () => Effect.void,
}

const heldDriver: Ports.Driver = {
  run: (input) =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      yield* Queue.offer(runs.queue!, { input, release })
      yield* Deferred.await(release)
    }),
  command: () => Effect.void,
}

const portsLayer = Ports.makeLayer(() => Effect.succeed({ driver: heldDriver, participants: [], hooks: {} }))

// `createRoutes` is `Layer<never, ...>` and publishes nothing, so the coordinator the handlers
// actually use has to be recorded as it is built. Resolving one from a separate build would be a
// DIFFERENT instance with its own fence registry, and a fence raised on it would be invisible here.
const capturingClosure = Layer.effect(
  SessionClosure.Service,
  Effect.gen(function* () {
    const real = yield* SessionClosure.Service
    captured.closure = real
    return real
  }),
).pipe(Layer.provide(SessionClosure.layer))
const capturingClosureNode = LayerNode.make({
  service: SessionClosure.Service,
  layer: capturingClosure,
  deps: [Ports.node, SessionToolPartPermit.node],
})

// Downstream work is stubbed for the same reason the K38 file stubs it: so the observable is
// attributable to admission rather than to a real provider call. The CLOSURE is deliberately real —
// that is the entire point of this file.
const revert = Layer.succeed(
  SessionRevert.Service,
  SessionRevert.Service.of({
    revert: () => Effect.die("unused revert"),
    unrevert: () => Effect.die("unused unrevert"),
    cleanup: () => Effect.sync(() => void trace.push("cleanup")),
  }),
)
const compact = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    isOverflow: () => Effect.die("unused isOverflow"),
    prune: () => Effect.die("unused prune"),
    process: () => Effect.die("unused process"),
    create: () => Effect.sync(() => void trace.push("compact")),
  }),
)
const reply = { info: { id: "msg_k55" }, parts: [] } as unknown as SessionV1.WithParts
const prompt = Layer.succeed(
  SessionPrompt.Service,
  SessionPrompt.Service.of({
    cancel: () => Effect.void,
    prompt: () => Effect.die("unused prompt"),
    loop: () => Effect.sync(() => trace.push("loop")).pipe(Effect.as(reply)),
    admitLoop: () =>
      Effect.sync(() => trace.push("loop")).pipe(Effect.as({ type: "completed", value: reply } as const)),
    awaitPublished: (published) => (published.type === "completed" ? Effect.succeed(published.value) : published.await),
    shell: () => Effect.die("unused shell"),
    command: () => Effect.die("unused command"),
    resolvePromptParts: () => Effect.die("unused resolvePromptParts"),
  }),
)

const replacements = [
  [Ports.node, portsLayer],
  [SessionClosure.node, capturingClosureNode],
  [SessionRevert.node, revert],
  [SessionCompaction.node, compact],
  [SessionPrompt.node, prompt],
] as const satisfies LayerNode.Replacements

const served: Layer.Layer<never, unknown, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.createRoutes(undefined, replacements),
  { disableListenLog: true, disableLogger: true },
)
const http = served.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(http)

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
  trace.length = 0
  await disposeAllInstances()
})

describe("summarize under a REAL fence (CP-023 K55)", () => {
  it.instance(
    "a real fence stops summarize before any deletion, compaction, or loop begins",
    () =>
      Effect.gen(function* () {
        runs.queue = yield* Queue.unbounded<HeldRun>()
        const test = yield* TestInstance
        const headers = { "content-type": "application/json" }
        const create = () =>
          request("/session", test.directory, { method: "POST", headers }).pipe(
            Effect.flatMap((response) => response.json),
            Effect.map((value) => value as { id: SessionID }),
          )
        const summarize = (id: SessionID) =>
          request(`/session/${id}/summarize`, test.directory, {
            method: "POST",
            headers,
            body: JSON.stringify({ providerID: "provider", modelID: "model" }),
          })

        // POSITIVE CONTROL. Unfenced, this graph runs summarize end to end and the instrument
        // records all three boundaries. Without it, the empty trace below would be worthless: it
        // would equally describe a harness that never reached the handler at all.
        const ok = yield* create()
        const completed = yield* summarize(ok.id).pipe(Effect.timeoutOption("10 seconds"))
        expect(completed._tag).toBe("Some")
        if (completed._tag !== "Some") return yield* Effect.die("unfenced summarize did not complete")
        expect(completed.value.status).toBe(200)
        expect(trace).toEqual(["cleanup", "compact", "loop"])

        // A REAL fence: a real closure request, parked at the real driver, claimed through the real
        // control surface. Nothing here is scripted.
        const blocked = yield* create()
        trace.length = 0
        const closure = captured.closure
        if (!closure) return yield* Effect.die("the composed coordinator was never captured")
        const pending = yield* closure.request({ root: blocked.id, runState: capability }).pipe(Effect.forkScoped)
        const held = yield* Queue.take(runs.queue!)
        const node = Model.id("session", blocked.id)
        const claimed = yield* held.input.control.claim({
          operation: held.input.command.operation,
          proofs: [{ value: "proven_connected", root: node, active: node, path: [node], edges: [] }],
          signals: [Effect.succeed("success" as const)],
        })

        // POSITIVE PRECONDITION. The claim applied and a fence for this exact session now stands,
        // so what follows is attributable to the fence and not to a misroute or an unrelated error.
        expect(claimed.decision).toEqual({ type: "applied" })
        expect((yield* closure.view).fences.map((item) => item.session)).toEqual([node])

        // THE LOAD-BEARING CLAIM. The request parks (external join, see the header note) and — the
        // part K55 actually asks for — NOTHING ran: no cleanup, no compaction, no loop, no provider.
        const parked = yield* summarize(blocked.id).pipe(Effect.timeoutOption("3 seconds"))
        expect(parked._tag).toBe("None")
        expect(trace).toEqual([])

        yield* Deferred.succeed(held.release, undefined)
        yield* Fiber.join(pending).pipe(Effect.exit)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
