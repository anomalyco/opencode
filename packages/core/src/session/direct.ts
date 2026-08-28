export * as DirectSession from "./direct.js"

import { Context, Effect, Exit, Fiber, Latch, Layer, Scope, Stream } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Instance } from "../instance.js"
import { Location } from "../location.js"
import { Mcp } from "../mcp/index.js"
import { PluginRuntime } from "../plugin/runtime.js"
import { PluginSupervisor } from "../plugin/supervisor.js"
import { Session } from "../session.js"
import { Shared } from "../shared.js"
import { McpTool } from "../tool/mcp.js"
import { SessionEvent } from "./event.js"
import { SessionSchema } from "./schema.js"

export { AlreadyBoundError, ClosedError } from "./bindings.js"
export { ID } from "./schema.js"

type Facts = Omit<Parameters<Session.Interface["create"]>[0], "id" | "location" | "parentID" | "discovery">
export type Options<Items extends Shared.Replacements = Shared.Replacements> = Facts &
  Omit<Instance.Options, "replacements"> & {
    readonly replacements?: LayerNode.ComposableReplacements<Items>
  } & (
    | { readonly id: SessionSchema.ID; readonly location?: Location.Ref }
    | { readonly id?: SessionSchema.ID; readonly location: Location.Ref }
  )

/** Creates/adopts durable facts, then binds a private ready instance to the caller's Scope. */
export const create = Effect.fn("DirectSession.create")(function* <
  const Items extends Shared.Replacements = readonly [],
>(options: Options<Items>) {
  const shared = yield* Shared.Service
  const discovery = options.discovery ?? false
  const session =
    options.location === undefined
      ? yield* options.id === undefined
          ? Effect.die(new Error("DirectSession.create requires a location or an existing Session ID"))
          : shared.sessions.get(options.id)
      : yield* shared.sessions.create({
          id: options.id,
          location: options.location,
          title: options.title,
          agent: options.agent,
          model: options.model,
          metadata: options.metadata,
          discovery,
        })
  // The backing provider may close before the caller's Scope.
  const scope = yield* Scope.fork(shared.scope)
  yield* Effect.addFinalizer((exit) => Scope.close(scope, exit))
  return yield* Effect.gen(function* () {
    const binding = yield* shared.bindings.reserve(session.id)
    const ready = yield* Latch.make()
    const cell = PluginRuntime.makeCell(ready.await)
    const replacements: Shared.Replacements = [
      ...shared.replacements,
      ...(options.replacements ?? []),
      [PluginRuntime.node, PluginRuntime.layerWithCell(cell)],
    ]
    const context = yield* Layer.build(
      Instance.compose(session.location, { ...options, discovery, replacements }),
    ).pipe(Effect.provideContext(shared.globals))
    const location = Context.get(context, Location.Service)
    const info = new Location.Info({
      directory: location.directory,
      workspaceID: location.workspaceID,
      project: location.project,
    })
    const bound = <A, E>(effect: Effect.Effect<A, E>) => binding.check.pipe(Effect.orDie, Effect.andThen(effect))
    const at = <A, E>(ref: Location.Ref, effect: Effect.Effect<A, E>) =>
      bound(
        ref.directory === location.directory && ref.workspaceID === location.workspaceID
          ? effect
          : Effect.die(new Error("Direct instances can only inspect their bound Location")),
      )
    cell.runtime = {
      session: {
        ...shared.sessions,
        create: (input) => bound(shared.sessions.create({ ...input, discovery })),
        prompt: (input) => bound(shared.sessions.prompt(input)),
        synthetic: (input) => bound(shared.sessions.synthetic(input)),
        command: (input) => bound(shared.sessions.command(input)),
        generate: (input) => bound(shared.sessions.generate(input)),
        rename: (input) => bound(shared.sessions.rename(input)),
        move: (input) => bound(shared.sessions.move(input)),
        switchAgent: (input) => bound(shared.sessions.switchAgent(input)),
        switchModel: (input) => bound(shared.sessions.switchModel(input)),
      },
      job: shared.jobs,
      persistentPty: shared.persistentPty,
      location: {
        agent: {
          list: (ref) =>
            at(
              ref,
              Context.get(context, Agent.Service)
                .list()
                .pipe(Effect.map((data) => ({ location: info, data }))),
            ),
        },
        mcp: {
          list: (ref) =>
            at(
              ref,
              Context.get(context, Mcp.Service)
                .servers()
                .pipe(Effect.map((data) => ({ location: info, data }))),
            ),
        },
      },
    }
    yield* binding.activate(context)
    yield* ready.open
    const observations = yield* Scope.fork(scope)
    yield* Effect.addFinalizer(() =>
      binding.shutdown(shared.execution).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cell.runtime = undefined
          }),
        ),
      ),
    )
    yield* Context.get(context, PluginSupervisor.Service).flush
    yield* Context.get(context, McpTool.Service).flush

    const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      binding.check.pipe(Effect.andThen(effect.pipe(Effect.forkIn(scope))), Effect.flatMap(Fiber.join))
    const bus = Context.get(shared.globals, Bus.Service)
    return {
      id: session.id,
      prompt: (input: Omit<Parameters<Session.Interface["prompt"]>[0], "sessionID">) =>
        run(shared.sessions.prompt({ ...input, sessionID: session.id })),
      resume: () => run(shared.sessions.resume(session.id)),
      interrupt: () => run(shared.sessions.interrupt(session.id)),
      wait: () => run(shared.sessions.wait(session.id)),
      events: {
        subscribe: <E, R>(callback: (event: SessionEvent.Event) => Effect.Effect<void, E, R>) =>
          binding.check.pipe(
            Effect.andThen(
              Effect.gen(function* () {
                const caller = yield* Scope.Scope
                const observer = yield* Scope.fork(observations)
                const events = yield* bus.observe(session.id).pipe(Scope.provide(observer))
                return yield* events.pipe(
                  Stream.runForEach(callback),
                  Scope.provide(observer),
                  Effect.onExit((exit) => Scope.close(observer, exit)),
                  Effect.forkIn(observer),
                  Effect.map(Fiber.runIn(caller)),
                )
              }),
            ),
          ),
      },
    }
  }).pipe(
    Scope.provide(scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
  )
})

export type Handle = Effect.Success<ReturnType<typeof create>>
