import path from "node:path"
import { describe, expect } from "bun:test"
import { LLMClient, type LLMRequest } from "@opencode-ai/ai"
import { TestLLM } from "@opencode-ai/ai/testing"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { LocationWatcher } from "@opencode-ai/core/filesystem/location-watcher"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Skill } from "@opencode-ai/core/skill"
import { Tool } from "@opencode-ai/core/tool"
import { SubagentTool } from "@opencode-ai/core/tool/plugin/subagent"
import { Agent, Model, Plugin, Provider } from "@opencode-ai/plugin/effect"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Global } from "@opencode-ai/util/global"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { AbsolutePath, Location, Session, Shared } from "../src/direct/effect"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ providerID: Provider.ID.make("direct-test"), id: Model.ID.make("fictional-chat") })
const modelPlugin = Plugin.define({
  id: "direct-model",
  effect: (ctx) =>
    ctx.catalog.transform((catalog) => {
      catalog.provider.update(model.providerID, (provider) => {
        provider.activation = "enabled"
        provider.package = "@opencode-ai/ai/providers/openai/chat"
        provider.settings = { baseURL: "https://provider.example/v1" }
      })
      catalog.model.update(model.providerID, model.id, (draft) => {
        draft.capabilities = { tools: true, input: ["text"], output: ["text"] }
        draft.limit = { context: 100_000, output: 1_000 }
      })
      catalog.model.default.set(model.providerID, model.id)
    }),
})

const reviewerPlugin = Plugin.define({
  id: "direct-reviewer",
  effect: (ctx) =>
    ctx.agent.transform((agents) => {
      agents.update("build", (agent) => {
        agent.permissions.push({ action: "subagent", resource: "reviewer", effect: "allow" })
      })
      agents.update("reviewer", (agent) => {
        agent.mode = "subagent"
        agent.model = model
      })
    }),
})

const withShared = <A, E, R>(
  body: (fixture: { readonly location: Location.Ref; readonly llm: TestLLM.TestInterface }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped("opencode-direct-session-")
    // Acquire the client outside the fresh graphs so every Session uses these controls.
    const llm = yield* TestLLM.Test.pipe(Effect.provide(TestLLM.testLayer()))
    return yield* body({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
      llm,
    }).pipe(
      Effect.provide(
        Shared.layer({
          database: { path: ":memory:" },
          replacements: [
            [Global.node, tempGlobalLayer],
            [llmClient, Layer.succeed(LLMClient.Service, llm)],
            [ModelsDev.node, ModelsDev.configured({ fetch: false })],
            [Watcher.node, Watcher.configured({ enabled: false })],
            [Bus.node, Bus.configured({ persist: true })],
          ],
        }),
      ),
    )
  })

type Execution = { readonly sessionID: Session.ID; readonly capability: string; readonly text: string }

const capability = (name: string, executions: Execution[] = [], prompts: Session.ID[] = []) =>
  Plugin.define({
    // Deliberately reuse the plugin and skill IDs across private graphs.
    id: "direct-capability",
    effect: (ctx) =>
      Effect.gen(function* () {
        const skill = Skill.Info.make({
          id: Skill.ID.make("direct-policy"),
          name: Skill.Name.make("Direct Policy"),
          description: `${name} policy`,
          location: AbsolutePath.make(path.join(ctx.location.directory, "policy.md")),
          content: `${name} skill guidance`,
        })
        yield* ctx.skill.transform((skills) => skills.add(skill))
        yield* ctx.session.hook("prompt", (event) =>
          Effect.sync(() => {
            prompts.push(event.sessionID)
            event.prompt.text = `${name}: ${event.prompt.text}`
            event.prompt.skills = [{ id: skill.id }]
          }),
        )
        yield* ctx.tool
          .transform((tools) =>
            tools.add({
              name: `${name}_tool`,
              description: `Execute the ${name} capability`,
              options: { codemode: false },
              input: Schema.Struct({ text: Schema.String }),
              output: Schema.Struct({ capability: Schema.String, text: Schema.String }),
              execute: (input, context) =>
                Effect.sync(() => {
                  executions.push({ sessionID: context.sessionID, capability: name, text: input.text })
                  return { output: { capability: name, text: input.text } }
                }),
            }),
          )
          .pipe(Effect.orDie)
      }),
  })

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [],
  )

class EventSink extends Context.Service<EventSink, SessionEvent.Event[]>()("test/direct-session/EventSink") {}

const checkTypes = (handle: Session.Handle, options: Session.Options) => {
  const create = Session.create(options)
  const constructor: Effect.Effect<Session.Handle, unknown, Shared.Service | Scope.Scope> = create
  // @ts-expect-error Creating a direct Session requires caller-owned shared infrastructure.
  const missingShared: Effect.Effect<Session.Handle, unknown, Scope.Scope> = create
  // @ts-expect-error Creating a direct Session also requires a lifetime Scope.
  const missingScope: Effect.Effect<Session.Handle, unknown, Shared.Service> = create
  const observe = handle.events.subscribe(() => EventSink.pipe(Effect.asVoid))
  const subscription: Effect.Effect<Fiber.Fiber<void>, unknown, EventSink | Scope.Scope> = observe
  // @ts-expect-error The callback's services must be supplied when subscribing.
  const missingCallback: Effect.Effect<Fiber.Fiber<void>, unknown, Scope.Scope> = observe
  const supplied: Effect.Effect<Fiber.Fiber<void>, unknown, Scope.Scope> = observe.pipe(
    Effect.provideService(EventSink, []),
  )
  // @ts-expect-error New Session creation needs a Location; adoption needs an ID.
  Session.create({})

  const open = Layer.effectDiscard(EventSink)
  const fallible = Layer.effectDiscard(Effect.fail(new Error("Replacement acquisition failed")))
  const fallibleNode = makeGlobalNode({ name: "test/fallible-replacement", layer: fallible, deps: [] })
  // @ts-expect-error Ready Shared constructors cannot silently acquire open replacement layers.
  Shared.layer({ replacements: [[Bus.node, open]] })
  // @ts-expect-error Ready Shared constructors cannot silently erase replacement errors.
  Shared.layer({ replacements: [[Bus.node, fallible]] })
  // @ts-expect-error Fallible replacement nodes are rejected too.
  Shared.layer({ replacements: [[Bus.node, fallibleNode]] })
  // @ts-expect-error Direct Session replacement layers must be closed.
  Session.create({ ...options, replacements: [[PluginHooks.node, open]] })
  // @ts-expect-error Direct Session replacement layers must be infallible.
  Session.create({ ...options, replacements: [[PluginHooks.node, fallible]] })
  // @ts-expect-error Direct Session replacement nodes must be infallible.
  Session.create({ ...options, replacements: [[PluginHooks.node, fallibleNode]] })
  // @ts-expect-error Shared replacements must provide the service they replace.
  Shared.layer({ replacements: [[Bus.node, Layer.succeed(EventSink, [])]] })
  // @ts-expect-error Direct Session replacements must provide the service they replace.
  Session.create({ ...options, replacements: [[PluginHooks.node, Layer.succeed(EventSink, [])]] })
  void [constructor, missingShared, missingScope, subscription, missingCallback, supplied]
}
void checkTypes

describe("direct Session", () => {
  it.live("closes private instances before Shared backing when the caller Scope outlives its provider", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped("opencode-direct-owner-")
      const lifecycle: string[] = []
      const owner = yield* Scope.Scope
      const caller = yield* Scope.fork(owner)
      const handle = yield* Session.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
        plugins: [
          Plugin.define({
            id: "direct-lifetime",
            effect: () =>
              Effect.addFinalizer(() =>
                Effect.sync(() => {
                  lifecycle.push("instance")
                }),
              ),
          }),
        ],
      }).pipe(
        Scope.provide(caller),
        Effect.provide(
          Shared.layer({
            replacements: [
              [
                Global.node,
                Layer.effectContext(
                  Effect.gen(function* () {
                    const context = yield* Layer.build(tempGlobalLayer)
                    yield* Effect.addFinalizer(() =>
                      Effect.sync(() => {
                        lifecycle.push("shared")
                      }),
                    )
                    return context
                  }),
                ),
              ],
              [ModelsDev.node, ModelsDev.configured({ fetch: false })],
              [Watcher.node, Watcher.configured({ enabled: false })],
            ],
          }),
        ),
      )
      expect(lifecycle).toEqual(["instance", "shared"])
      expect(yield* handle.prompt({ text: "After provider close", resume: false }).pipe(Effect.exit)).toEqual(
        Exit.fail(new Session.ClosedError({ sessionID: handle.id })),
      )
      yield* Scope.close(caller, Exit.void)
      expect(lifecycle).toEqual(["instance", "shared"])
    }),
  )

  it.live(
    "waits for runtime installation when plugin setup calls Session APIs before the graph is acquired",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const id = Session.ID.create()
          const graphRelease = yield* Deferred.make<void>()
          const pluginStarted = yield* Deferred.make<Fiber.Fiber<unknown>>()
          const late = LocationWatcher.node.implementation
          if (!Layer.isLayer(late)) throw new Error("LocationWatcher must have a layer implementation")
          const held = {
            ...LocationWatcher.node,
            implementation: late.pipe(Layer.tap(() => Deferred.await(graphRelease))),
          }
          const creating = yield* Session.create({
            id,
            location: fixture.location,
            title: "Startup readiness",
            replacements: [[LocationWatcher.node, held]],
            plugins: [
              Plugin.define({
                id: "direct-startup",
                effect: (ctx) =>
                  Effect.gen(function* () {
                    // Start the call before signaling, so polling below observes a real suspended lookup.
                    const lookup = yield* ctx.session
                      .get({ sessionID: id })
                      .pipe(Effect.orDie, Effect.forkScoped({ startImmediately: true }))
                    yield* Deferred.succeed(pluginStarted, lookup)
                    expect((yield* Fiber.join(lookup)).id).toBe(id)
                    yield* ctx.session.hook("prompt", (event) =>
                      Effect.sync(() => {
                        event.prompt.text = "Plugin setup finished"
                      }),
                    )
                  }),
              }),
            ],
          }).pipe(Effect.forkScoped({ startImmediately: true }))

          const lookup = yield* Deferred.await(pluginStarted).pipe(Effect.timeout("5 seconds"))
          expect(lookup.pollUnsafe()).toBeUndefined()
          expect(creating.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(graphRelease, undefined)
          const handle = yield* Fiber.join(creating).pipe(Effect.timeout("5 seconds"))

          expect((yield* handle.prompt({ text: "After readiness", resume: false })).payload.text).toBe(
            "Plugin setup finished",
          )
          expect(yield* fixture.llm.requests()).toEqual([])
        }),
      ),
    15_000,
  )

  it.live(
    "executes isolated tools, prompt hooks, and skill attachments in the same directory",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const executions: Execution[] = []
          const firstPrompts: Session.ID[] = []
          const secondPrompts: Session.ID[] = []
          const first = yield* Session.create({
            location: fixture.location,
            title: "First",
            plugins: [modelPlugin, capability("first", executions, firstPrompts)],
          })
          const second = yield* Session.create({
            location: fixture.location,
            title: "Second",
            plugins: [modelPlugin, capability("second", executions, secondPrompts)],
          })
          yield* fixture.llm.push(
            TestLLM.tool("call-first", "first_tool", { text: "one" }),
            TestLLM.text("First complete", "answer-first"),
            TestLLM.tool("call-second", "second_tool", { text: "two" }),
            TestLLM.text("Second complete", "answer-second"),
          )

          const firstInput = yield* first.prompt({ text: "Use my tool" })
          yield* first.wait()
          const secondInput = yield* second.prompt({ text: "Use my tool" })
          yield* second.wait()

          expect(first.id).not.toBe(second.id)
          expect(executions).toEqual([
            { sessionID: first.id, capability: "first", text: "one" },
            { sessionID: second.id, capability: "second", text: "two" },
          ])
          expect(firstPrompts).toEqual([first.id])
          expect(secondPrompts).toEqual([second.id])
          expect(firstInput.payload.text).toBe("first: Use my tool")
          expect(secondInput.payload.text).toBe("second: Use my tool")
          expect(firstInput.payload.skills?.[0]?.text).toContain("first skill guidance")
          expect(firstInput.payload.skills?.[0]?.text).not.toContain("second skill guidance")
          expect(secondInput.payload.skills?.[0]?.text).toContain("second skill guidance")
          expect(secondInput.payload.skills?.[0]?.text).not.toContain("first skill guidance")

          const requests = yield* fixture.llm.requests()
          expect(requests).toHaveLength(4)
          requests.slice(0, 2).forEach((request) => {
            expect(request.tools.map((tool) => tool.name)).toContain("first_tool")
            expect(request.tools.map((tool) => tool.name)).not.toContain("second_tool")
            expect(userTexts(request).join("\n")).toContain("first skill guidance")
          })
          requests.slice(2).forEach((request) => {
            expect(request.tools.map((tool) => tool.name)).toContain("second_tool")
            expect(request.tools.map((tool) => tool.name)).not.toContain("first_tool")
            expect(userTexts(request).join("\n")).toContain("second skill guidance")
          })
          expect(yield* shared.sessions.context(first.id)).toContainEqual(
            expect.objectContaining({ id: firstInput.id, type: "user", text: "first: Use my tool" }),
          )
          expect(yield* shared.sessions.context(second.id)).toContainEqual(
            expect.objectContaining({ id: secondInput.id, type: "user", text: "second: Use my tool" }),
          )
          expect(yield* shared.sessions.inbox(first.id)).toEqual([])
          expect(yield* shared.sessions.inbox(second.id)).toEqual([])
        }),
      ),
    20_000,
  )

  it.live(
    "subscribes ready and isolates admission and runner events with the caller's services",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const first = yield* Session.create({ location: fixture.location, title: "First", plugins: [modelPlugin] })
          const second = yield* Session.create({ location: fixture.location, title: "Second", plugins: [modelPlugin] })
          const firstEvents: SessionEvent.Event[] = []
          const secondEvents: SessionEvent.Event[] = []
          const firstEnqueued = yield* Deferred.make<SessionEvent.InboxEnqueued>()
          const secondEnqueued = yield* Deferred.make<SessionEvent.InboxEnqueued>()
          const firstDone = yield* Deferred.make<void>()
          const secondDone = yield* Deferred.make<void>()
          const observe =
            (enqueued: Deferred.Deferred<SessionEvent.InboxEnqueued>, done: Deferred.Deferred<void>) =>
            (event: SessionEvent.Event) =>
              Effect.gen(function* () {
                const events = yield* EventSink
                events.push(event)
                if (event.type === "session.inbox.enqueued") yield* Deferred.succeed(enqueued, event)
                if (event.type === "session.execution.succeeded") yield* Deferred.succeed(done, undefined)
              })

          yield* first.events
            .subscribe(observe(firstEnqueued, firstDone))
            .pipe(Effect.provideService(EventSink, firstEvents))
          // No connected marker, scheduler yield, or delay before the first prompt.
          const firstInput = yield* first.prompt({ text: "First event", resume: false })
          yield* second.events
            .subscribe(observe(secondEnqueued, secondDone))
            .pipe(Effect.provideService(EventSink, secondEvents))
          const secondInput = yield* second.prompt({ text: "Second event", resume: false })
          expect((yield* Deferred.await(firstEnqueued).pipe(Effect.timeout("5 seconds"))).data.inboxID).toBe(
            firstInput.id,
          )
          expect((yield* Deferred.await(secondEnqueued).pipe(Effect.timeout("5 seconds"))).data.inboxID).toBe(
            secondInput.id,
          )
          yield* fixture.llm.push(TestLLM.text("First", "answer-first"), TestLLM.text("Second", "answer-second"))
          yield* first.resume()
          yield* second.resume()
          yield* Effect.all([Deferred.await(firstDone), Deferred.await(secondDone)]).pipe(Effect.timeout("5 seconds"))

          expect(firstEvents.map((event) => event.data.sessionID)).toEqual(firstEvents.map(() => first.id))
          expect(secondEvents.map((event) => event.data.sessionID)).toEqual(secondEvents.map(() => second.id))
          ;[firstEvents, secondEvents].forEach((events) => {
            expect(events.map((event) => event.type)).toEqual(
              expect.arrayContaining([
                "session.inbox.enqueued",
                "session.inbox.delivered",
                "session.step.started",
                "session.execution.succeeded",
              ]),
            )
          })
        }),
      ),
    20_000,
  )

  it.live(
    "keeps callback failures on the subscription fiber without failing prompt admission",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const handle = yield* Session.create({ location: fixture.location, title: "Callback failure" })
          const failure = new Error("Observer failed")
          const released = yield* Deferred.make<void>()
          const observer = yield* handle.events.subscribe(() =>
            Effect.acquireRelease(Effect.void, () => Deferred.succeed(released, undefined).pipe(Effect.asVoid)).pipe(
              Effect.andThen(Effect.fail(failure)),
            ),
          )

          const input = yield* handle.prompt({ text: "Still admitted", resume: false })

          expect(yield* Fiber.join(observer).pipe(Effect.flip, Effect.timeout("5 seconds"))).toBe(failure)
          yield* Deferred.await(released).pipe(Effect.timeout("5 seconds"))
          expect(yield* shared.sessions.inbox(handle.id)).toEqual([input])
          expect(yield* fixture.llm.requests()).toEqual([])
        }),
      ),
    15_000,
  )

  it.live(
    "stops observations when their caller Scope or handle Scope closes",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const scope = yield* Scope.Scope
          const handleScope = yield* Scope.fork(scope)
          const subscriptionScope = yield* Scope.fork(scope)
          const handle = yield* Session.create({ location: fixture.location, title: "Scoped observations" }).pipe(
            Scope.provide(handleScope),
          )
          const enqueued = yield* Deferred.make<void>()
          const events: SessionEvent.Event[] = []
          const observer = yield* handle.events
            .subscribe((event) =>
              Effect.gen(function* () {
                events.push(event)
                if (event.type === "session.inbox.enqueued") yield* Deferred.succeed(enqueued, undefined)
              }),
            )
            .pipe(Scope.provide(subscriptionScope))
          yield* handle.prompt({ text: "Observed", resume: false })
          yield* Deferred.await(enqueued).pipe(Effect.timeout("5 seconds"))

          yield* Scope.close(subscriptionScope, Exit.void)
          const stopped = yield* Fiber.await(observer)
          yield* handle.prompt({ text: "Not observed", resume: false })
          expect(events.map((event) => event.type)).toEqual(["session.inbox.enqueued"])

          const owned = yield* handle.events.subscribe(() => Effect.void)
          yield* Scope.close(handleScope, Exit.void)
          const closed = yield* Fiber.await(owned)
          ;[stopped, closed].forEach((exit) => {
            // fromSubscription can append its normal Done marker to the interruption cause.
            expect(
              Exit.isSuccess(exit) ||
                exit.cause.reasons.every(
                  (reason) =>
                    Cause.isInterruptReason(reason) || (Cause.isFailReason(reason) && Cause.isDone(reason.error)),
                ),
            ).toBe(true)
          })
        }),
      ),
    15_000,
  )

  it.live("does not retain caller finalizers after observation fibers finish", () =>
    withShared((fixture) =>
      Effect.gen(function* () {
        const caller = yield* Scope.Scope
        const handle = yield* Session.create({ location: fixture.location, title: "Observer cleanup" })
        if (caller.state._tag !== "Open") throw new Error("Expected the caller's handle cleanup")
        const finalizers = caller.state.finalizers
        if (!finalizers) throw new Error("Expected registered caller finalizers")
        const before = finalizers.size
        yield* Effect.forEach(Array.from({ length: 5 }), () =>
          Effect.gen(function* () {
            const observer = yield* handle.events.subscribe(() => Effect.void)
            yield* Fiber.interrupt(observer)
            expect(finalizers.size).toBe(before)
          }),
        )
      }),
    ),
  )

  it.live(
    "creates and resumes a native subagent with its parent's private capabilities",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const executions: Execution[] = []
          const prompts: Session.ID[] = []
          const parent = yield* Session.create({
            location: fixture.location,
            title: "Parent",
            model,
            metadata: { owner: "parent" },
            plugins: [modelPlugin, capability("parent", executions, prompts), reviewerPlugin],
          })
          // A later sibling at the same Location must not become the child's instance.
          yield* Session.create({
            location: fixture.location,
            title: "Sibling",
            plugins: [modelPlugin, capability("sibling", executions)],
          })
          yield* fixture.llm.push(
            TestLLM.tool("call-subagent", SubagentTool.name, {
              agent: "reviewer",
              description: "Child",
              prompt: "Use my inherited tool",
            }),
            TestLLM.tool("call-child-tool", "parent_tool", { text: "child" }),
            TestLLM.text("Child complete", "answer-child"),
            TestLLM.text("Parent complete", "answer-parent"),
          )
          yield* parent.prompt({ text: "Delegate" })
          yield* parent.wait()

          const children = (yield* shared.sessions.list({ parentID: parent.id })).data
          expect(children).toHaveLength(1)
          const child = children[0]
          expect(child).toMatchObject({
            parentID: parent.id,
            location: fixture.location,
            agent: "reviewer",
            model,
            metadata: { owner: "parent" },
          })
          expect(executions).toEqual([{ sessionID: child.id, capability: "parent", text: "child" }])
          expect(prompts).toEqual([parent.id, child.id])
          expect((yield* shared.sessions.context(child.id)).find((message) => message.type === "user")).toMatchObject({
            text: "parent: You are a subagent spawned by another session.\nUse my inherited tool",
          })

          yield* fixture.llm.push(
            TestLLM.tool("call-continue-child", SubagentTool.name, {
              sessionID: child.id,
              agent: "reviewer",
              description: "Continue",
              prompt: "Use it again",
            }),
            TestLLM.tool("call-child-again", "parent_tool", { text: "continued" }),
            TestLLM.text("Child continued", "answer-child-again"),
            TestLLM.text("Parent continued", "answer-parent-again"),
          )
          yield* parent.prompt({ text: "Continue the same child" })
          yield* parent.wait()

          expect((yield* shared.sessions.list({ parentID: parent.id })).data.map((session) => session.id)).toEqual([
            child.id,
          ])
          expect(executions).toEqual([
            { sessionID: child.id, capability: "parent", text: "child" },
            { sessionID: child.id, capability: "parent", text: "continued" },
          ])
          expect(prompts).toEqual([parent.id, child.id, parent.id, child.id])
          const requests = yield* fixture.llm.requests()
          expect(requests).toHaveLength(8)
          requests.forEach((request) => {
            expect(request.tools.map((tool) => tool.name)).toContain("parent_tool")
            expect(request.tools.map((tool) => tool.name)).not.toContain("sibling_tool")
          })
          expect(yield* shared.sessions.context(parent.id)).toContainEqual(
            expect.objectContaining({
              type: "assistant",
              content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Parent continued" })]),
            }),
          )
        }),
      ),
    25_000,
  )
  ;[false, true].forEach((background) =>
    it.live(
      background
        ? "preserves background child recovery without admitting a cancellation synthetic on handle shutdown"
        : "retains foreground parent and child claims with shutdown interruption for the whole ownership chain",
      () =>
        withShared((fixture) =>
          Effect.gen(function* () {
            const shared = yield* Shared.Service
            const owner = yield* Scope.Scope
            const scope = yield* Scope.fork(owner)
            const parent = yield* Session.create({
              location: fixture.location,
              title: "Parent",
              model,
              plugins: [modelPlugin, reviewerPlugin],
            }).pipe(Scope.provide(scope))
            let parentCalls = 0
            yield* fixture.llm.serve((request) => {
              // Match the child by its real prompt so background scheduling cannot reorder scripted replies.
              if (userTexts(request).some((text) => text.includes("You are a subagent"))) return TestLLM.hangAfter()
              return ++parentCalls === 1
                ? TestLLM.tool("call-shutdown-subagent", SubagentTool.name, {
                    agent: "reviewer",
                    description: "Child",
                    prompt: "Work",
                    background,
                  })
                : TestLLM.text("Parent done", "parent-answer")
            })
            yield* parent.prompt({ text: "Delegate" })
            yield* fixture.llm.wait(background ? 3 : 2).pipe(Effect.timeout("5 seconds"))
            if (background) yield* parent.wait()

            const children = (yield* shared.sessions.list({ parentID: parent.id })).data
            expect(children).toHaveLength(1)
            const child = children[0]
            expect((yield* shared.jobs.get(child.id))?.status).toBe("running")
            const beforeMarkers = yield* shared.jobs.pendingBackground
            expect(beforeMarkers).toHaveLength(background ? 1 : 0)

            yield* Scope.close(scope, Exit.void)

            expect(yield* shared.execution.active).toEqual(new Set())
            expect((yield* shared.jobs.get(child.id))?.status).toBe("cancelled")
            expect(yield* shared.sessions.inbox(parent.id)).toEqual([])
            expect(yield* shared.sessions.inbox(child.id)).toEqual([])
            const markers = yield* shared.jobs.pendingBackground
            expect(markers).toHaveLength(background ? 1 : 0)
            if (background) {
              expect(markers[0]).toMatchObject({
                id: child.id,
                status: "running",
                notificationID: beforeMarkers[0].notificationID,
                recovery: { kind: "subagent", parentSessionID: parent.id, childSessionID: child.id },
              })
            }

            const database = Context.get(shared.globals, Database.Service)
            const claims = yield* database.db
              .select({ id: SessionTable.id, suspended: SessionTable.time_suspended })
              .from(SessionTable)
              .all()
            expect(claims).toHaveLength(2)
            expect(claims.find((row) => row.id === child.id)?.suspended).toEqual(expect.any(Number))
            expect(claims.find((row) => row.id === parent.id)?.suspended).toEqual(
              background ? null : expect.any(Number),
            )
            // Read durable logs after closing; handle observations have already been torn down.
            const logs = yield* Effect.forEach([parent.id, child.id], (sessionID) =>
              shared.sessions.log({ sessionID, follow: false }).pipe(Stream.runCollect),
            )
            const interruptions = logs.flat().filter((event) => event.type === "session.execution.interrupted")
            expect(interruptions).toHaveLength(background ? 1 : 2)
            interruptions.forEach((event) => expect(event.data.reason).toBe("shutdown"))
            expect(
              logs[0].filter(
                (event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic",
              ),
            ).toEqual([])
          }),
        ),
      20_000,
    ),
  )

  it.live(
    "adopts saved facts without auto-running pending work and explicitly resumes with new capabilities",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const id = Session.ID.create()
          const recorded = yield* Effect.gen(function* () {
            const handle = yield* Session.create({
              id,
              location: fixture.location,
              title: "Saved title",
              agent: Agent.ID.make("build"),
              model,
              metadata: { owner: "saved" },
              plugins: [modelPlugin, capability("original")],
            })
            const pending = yield* handle.prompt({
              id: SessionMessage.ID.create(),
              text: "Pending work",
              resume: false,
            })
            return { info: yield* shared.sessions.get(id), pending }
          }).pipe(Effect.scoped)
          const executions: Execution[] = []
          const adoptedPrompts: Session.ID[] = []

          yield* Effect.gen(function* () {
            const adopted = yield* Session.create({
              id,
              location: Location.Ref.make({
                directory: AbsolutePath.make(path.join(fixture.location.directory, "ignored-location")),
              }),
              title: "Ignored title",
              agent: Agent.ID.make("ignored-agent"),
              model: Model.Ref.make({ providerID: model.providerID, id: Model.ID.make("fictional-other") }),
              metadata: { owner: "ignored" },
              plugins: [modelPlugin, capability("adopted", executions, adoptedPrompts)],
            })
            expect(adopted.id).toBe(id)
            expect(yield* shared.sessions.get(id)).toEqual(recorded.info)
            expect(yield* shared.sessions.inbox(id)).toEqual([recorded.pending])
            yield* adopted.wait()
            expect(yield* fixture.llm.requests()).toEqual([])

            yield* fixture.llm.push(
              TestLLM.tool("call-adopted", "adopted_tool", { text: "resumed" }),
              TestLLM.text("Resumed", "answer-adopted"),
            )
            yield* adopted.resume()
            yield* adopted.wait()
            expect(yield* shared.sessions.inbox(id)).toEqual([])
            expect(executions).toEqual([{ sessionID: id, capability: "adopted", text: "resumed" }])
            expect(adoptedPrompts).toEqual([])
            expect(yield* shared.sessions.context(id)).toContainEqual(
              expect.objectContaining({ id: recorded.pending.id, type: "user", text: "original: Pending work" }),
            )
            const requests = yield* fixture.llm.requests()
            expect(requests).toHaveLength(2)
            expect(requests[0].model).toMatchObject({ provider: model.providerID, id: model.id })
            expect(userTexts(requests[0]).join("\n")).toContain("original skill guidance")
            expect(requests[0].tools.map((tool) => tool.name)).not.toContain("original_tool")
          }).pipe(Effect.scoped)

          const reopened = yield* Session.create({ id, plugins: [modelPlugin, capability("reopened")] })
          const next = yield* reopened.prompt({ text: "Next input", resume: false })
          expect(next.payload.text).toBe("reopened: Next input")
          expect((yield* shared.sessions.get(id)).location).toEqual(recorded.info.location)
        }),
      ),
    25_000,
  )

  it.live(
    "rejects a conflicting live binding without changing the original handle",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const first = yield* Session.create({
            location: fixture.location,
            title: "Original",
            plugins: [capability("first")],
          })
          const conflict = yield* Session.create({
            id: first.id,
            location: fixture.location,
            title: "Replacement",
            plugins: [capability("replacement")],
          }).pipe(Effect.flip)

          expect(conflict).toMatchObject({ _tag: "Session.AlreadyBoundError", sessionID: first.id })
          expect((yield* shared.sessions.get(first.id)).title).toBe("Original")
          expect((yield* first.prompt({ text: "Still mine", resume: false })).payload.text).toBe("first: Still mine")
          expect(yield* fixture.llm.requests()).toEqual([])
        }),
      ),
    15_000,
  )

  it.live(
    "rejects closed handles, including effects constructed before closure",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const closed = yield* Effect.gen(function* () {
            const handle = yield* Session.create({ location: fixture.location, title: "Closed" })
            return { handle, prompt: handle.prompt({ text: "Constructed while open", resume: false }) }
          }).pipe(Effect.scoped)

          const errors = yield* Effect.all([
            closed.prompt.pipe(Effect.flip),
            closed.handle.prompt({ text: "After close", resume: false }).pipe(Effect.flip),
            closed.handle.resume().pipe(Effect.flip),
            closed.handle.interrupt().pipe(Effect.flip),
            closed.handle.wait().pipe(Effect.flip),
            closed.handle.events.subscribe(() => Effect.void).pipe(Effect.flip),
          ])

          errors.forEach((error) =>
            expect(error).toMatchObject({ _tag: "Session.ClosedError", sessionID: closed.handle.id }),
          )
          expect(yield* shared.sessions.inbox(closed.handle.id)).toEqual([])
          expect(yield* fixture.llm.requests()).toEqual([])
        }),
      ),
    15_000,
  )
  ;(["interrupt", "close"] as const).forEach((operation) =>
    it.live(
      `${operation} settles only the selected Session and leaves its sibling runnable`,
      () =>
        withShared((fixture) =>
          Effect.gen(function* () {
            const shared = yield* Shared.Service
            const scope = yield* Scope.Scope
            const firstScope = yield* Scope.fork(scope)
            const first = yield* Session.create({
              location: fixture.location,
              title: "First",
              plugins: [modelPlugin],
            }).pipe(Scope.provide(firstScope))
            const second = yield* Session.create({
              location: fixture.location,
              title: "Second",
              plugins: [modelPlugin],
            })
            yield* fixture.llm.push(
              TestLLM.text("First complete", "answer-first"),
              TestLLM.text("Second complete", "answer-second"),
            )
            const gate = yield* fixture.llm.gate()
            yield* first.prompt({ text: "First" })
            yield* gate.started.pipe(Effect.timeout("5 seconds"))
            yield* second.prompt({ text: "Second" })
            yield* gate.started.pipe(Effect.timeout("5 seconds"))
            expect(yield* shared.execution.active).toEqual(new Set([first.id, second.id]))

            yield* operation === "close"
              ? Scope.close(firstScope, Exit.void)
              : first.interrupt().pipe(Effect.andThen(first.wait()))
            expect(yield* shared.execution.active).toEqual(new Set([second.id]))
            yield* gate.release
            yield* second.wait()

            expect(yield* shared.execution.active).toEqual(new Set())
            expect(yield* shared.sessions.context(second.id)).toContainEqual(
              expect.objectContaining({
                type: "assistant",
                content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Second complete" })]),
              }),
            )
            expect(yield* fixture.llm.requests()).toHaveLength(2)
            if (operation === "interrupt") expect(yield* first.interrupt()).toBe(false)
          }),
        ),
      20_000,
    ),
  )

  it.live(
    "reuses shared infrastructure identities while acquiring private registries and runtime bindings",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const shared = yield* Shared.Service
          const capture = Effect.all({
            database: Database.Service,
            bus: Bus.Service,
            global: Global.Service,
            llm: LLMClient.Service,
            store: SessionStore.Service,
            tools: Tool.Service,
            hooks: PluginHooks.Service,
            runtime: PluginRuntime.Service,
          })
          const instances: Array<Effect.Success<typeof capture>> = []
          const probe = {
            ...ModelResolver.node,
            implementation: Layer.merge(
              ModelResolver.layer,
              Layer.effectDiscard(capture.pipe(Effect.tap((instance) => Effect.sync(() => instances.push(instance))))),
            ),
            dependencies: [
              ...ModelResolver.node.dependencies,
              Database.node,
              Bus.node,
              Global.node,
              llmClient,
              SessionStore.node,
              Tool.node,
              PluginHooks.node,
              PluginRuntime.node,
            ],
          }
          const scope = yield* Scope.Scope
          const firstScope = yield* Scope.fork(scope)
          const first = yield* Session.create({
            location: fixture.location,
            title: "First",
            plugins: [modelPlugin],
            replacements: [[ModelResolver.node, probe]],
          }).pipe(Scope.provide(firstScope))
          const second = yield* Session.create({
            location: fixture.location,
            title: "Second",
            plugins: [modelPlugin],
            replacements: [[ModelResolver.node, probe]],
          })

          expect(instances).toHaveLength(2)
          instances.forEach((instance) => {
            expect(instance.database).toBe(Context.get(shared.globals, Database.Service))
            expect(instance.bus).not.toBe(Context.get(shared.globals, Bus.Service))
            expect(instance.global).toBe(Context.get(shared.globals, Global.Service))
            expect(instance.llm).toBe(fixture.llm)
            expect(instance.store).toBe(Context.get(shared.globals, SessionStore.Service))
          })
          expect(instances[0].tools).not.toBe(instances[1].tools)
          expect(instances[0].hooks).not.toBe(instances[1].hooks)
          expect(instances[0].bus).not.toBe(instances[1].bus)
          expect(instances[0].runtime).not.toBe(instances[1].runtime)
          expect(Option.isNone(Context.getOption(shared.globals, LocationServiceMap.Service))).toBe(true)

          const job = yield* instances[0].runtime.job.start({ type: "direct-test", run: Effect.never })
          expect(yield* shared.jobs.get(job.id)).toEqual(job)
          yield* instances[1].runtime.job.cancel(job.id)
          expect((yield* shared.jobs.get(job.id))?.status).toBe("cancelled")
          expect(yield* instances[1].runtime.session.get(first.id)).toEqual(yield* shared.sessions.get(first.id))

          yield* Scope.close(firstScope, Exit.void)
          yield* fixture.llm.push(TestLLM.text("Still shared", "answer-second"))
          yield* second.prompt({ text: "Survive sibling closure" })
          yield* second.wait()
          expect((yield* shared.sessions.get(first.id)).id).toBe(first.id)
          expect(yield* fixture.llm.requests()).toHaveLength(1)
          const bus = Context.get(shared.globals, Bus.Service)
          const log = yield* bus.log({ aggregateID: second.id }).pipe(Stream.runCollect)
          expect(log).toContainEqual(
            expect.objectContaining({
              type: "session.inbox.enqueued",
              durable: expect.objectContaining({ aggregateID: second.id }),
              data: expect.objectContaining({ sessionID: second.id }),
            }),
          )
        }),
      ),
    20_000,
  )

  it.live(
    "defaults discovery off without importing ambient plugins or instructions",
    () =>
      withShared((fixture) =>
        Effect.gen(function* () {
          const marker = path.join(fixture.location.directory, "ambient-loaded")
          yield* Effect.promise(() =>
            Bun.write(path.join(fixture.location.directory, "AGENTS.md"), "Ambient instruction sentinel"),
          )
          yield* Effect.promise(() =>
            Bun.write(
              path.join(fixture.location.directory, ".opencode/plugins/ambient.ts"),
              `await Bun.write(${JSON.stringify(marker)}, "loaded")\nexport default { id: "ambient-plugin", setup() {} }\n`,
            ),
          )
          const handle = yield* Session.create({ location: fixture.location, title: "Vanilla", plugins: [modelPlugin] })
          yield* fixture.llm.push(TestLLM.text("Vanilla", "answer-vanilla"))
          yield* handle.prompt({ text: "Use only supplied capabilities" })
          yield* handle.wait()

          expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
          const requests = yield* fixture.llm.requests()
          expect(requests).toHaveLength(1)
          expect(requests[0].system.map((part) => part.text).join("\n")).not.toContain("Ambient instruction sentinel")
          expect(requests[0].tools.map((tool) => tool.name)).toContain(SubagentTool.name)
        }),
      ),
    15_000,
  )
})
