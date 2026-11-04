import { expect } from "bun:test"
import { Event } from "@opencode/schema/config"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Context, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Session } from "@opencode/core/session"
import { WebSearch } from "@opencode/core/websearch"
import { organizationPolicy } from "./fixture/policy"
import { waitUntil } from "./lib/eventually"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.live("removes a failed plugin's hooks and RPC handlers without affecting healthy plugins", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const hooks = yield* PluginHooks.Service
    const rpc = yield* Rpc.Service
    const cleaned = yield* Deferred.make<void>()
    const invoked: string[] = []
    let fail = false
    yield* plugins.activate(
      ["broken", "healthy"].map((id) => ({
        id,
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            // Finalizers run in reverse order, so this signals after registration cleanup.
            if (id === "broken") yield* Effect.addFinalizer(() => Deferred.succeed(cleaned, undefined))
            yield* ctx.command.transform((editor) => {
              editor.add({ name: id, execute: () => Effect.void })
              if (id === "broken" && fail) throw new Error("transform failed")
            })
            yield* ctx.shell.hook("create.before", () => Effect.sync(() => void invoked.push(id)))
            yield* ctx.rpc
              .register(
                Rpc.define({ id, methods: { check: { input: Schema.Struct({}), output: Schema.String } }, events: {} }),
                { check: () => Effect.succeed(id) },
              )
              .pipe(Effect.orDie)
            if (id === "broken") yield* Effect.addFinalizer(() => plugins.awaitActivation)
          }),
      })),
    )
    const trigger = hooks.trigger("shell", "create.before", {
      command: "echo fixture",
      cwd: ".",
      timeout: 1_000,
      shell: "sh",
      env: {},
    })
    yield* trigger
    expect(invoked).toEqual(["broken", "healthy"])
    expect(yield* rpc.call("broken", "check", {})).toBe("broken")
    expect(yield* rpc.call("healthy", "check", {})).toBe("healthy")
    expect((yield* commands.list()).map((command) => command.name)).toEqual(["broken", "healthy"])

    fail = true
    yield* commands.reload()
    yield* Deferred.await(cleaned).pipe(Effect.timeout("1 second"))
    invoked.length = 0
    yield* trigger
    expect(invoked).toEqual(["healthy"])
    expect(yield* rpc.call("broken", "check", {}).pipe(Effect.flip)).toMatchObject({ type: "rpc.unavailable" })
    expect(yield* rpc.call("healthy", "check", {})).toBe("healthy")
    expect((yield* commands.list()).map((command) => command.name)).toEqual(["healthy"])
    expect((yield* plugins.list()).map((plugin) => plugin.state.status)).toEqual(["failed", "active"])
  }),
)

Array.of("reload", "teardown").forEach((boundary) =>
  it.live(`does not join queued failed-plugin cleanup during ${boundary}`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const commands = yield* Command.Service
      const entered = yield* Deferred.make<void>()
      const escape = yield* Deferred.make<void>()
      const cleaned = yield* Deferred.make<void>()
      let fail = false
      yield* plugins.activate([
        {
          id: "changing",
          revision: "1",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.command.transform((editor) => {
                editor.add({ name: "changing", description: "old", execute: () => Effect.void })
                if (fail) throw new Error("changing failed")
              })
              yield* Effect.addFinalizer(() =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(plugins.awaitActivation.pipe(Effect.raceFirst(Deferred.await(escape)))),
                  Effect.andThen(Deferred.succeed(cleaned, undefined)),
                ),
              )
            }),
        },
        {
          id: "trigger",
          revision: "1",
          effect: () =>
            Effect.addFinalizer(() =>
              boundary === "teardown"
                ? commands.reload().pipe(Effect.andThen(commands.list()), Effect.asVoid)
                : Effect.void,
            ),
        },
      ])
      fail = true
      const activation = yield* (boundary === "reload" ? commands.reload() : Effect.void).pipe(
        Effect.andThen(
          plugins.activate([
            {
              id: "changing",
              revision: "2",
              effect: (ctx) =>
                ctx.command
                  .transform((editor) =>
                    editor.add({ name: "changing", description: "new", execute: () => Effect.void }),
                  )
                  .pipe(Effect.asVoid),
            },
          ]),
        ),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(entered)
      const result = yield* Fiber.join(activation).pipe(Effect.timeout("250 millis"), Effect.exit)
      // Allow teardown to finish even if activation incorrectly joins the old finalizer.
      yield* Deferred.succeed(escape, undefined)
      yield* Fiber.join(activation)
      yield* plugins.awaitActivation
      yield* Deferred.await(cleaned)
      expect(Exit.isSuccess(result)).toBe(true)
      expect((yield* plugins.list())[0]?.state).toEqual({ status: "active" })
      expect(yield* commands.get("changing")).toMatchObject({ description: "new" })
    }),
  ),
)

it.live("does not restore a disabled generation with a pending failure when its replacement fails setup", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const loads: string[] = []
    let fail = false
    const generation = (revision: string): Plugin.Generation => ({
      id: "replacement",
      revision,
      effect: (ctx) =>
        Effect.gen(function* () {
          loads.push(revision)
          if (revision === "2") yield* Effect.die("setup failed")
          yield* ctx.command.transform((editor) => {
            editor.add({ name: "replacement", execute: () => Effect.void })
            if (fail) throw new Error("replay failed")
          })
        }),
    })
    yield* plugins.activate([generation("1")])
    fail = true
    yield* commands.reload()
    yield* plugins.activate([generation("2")])
    yield* plugins.awaitActivation
    expect(loads).toEqual(["1", "2"])
    expect((yield* plugins.list())[0]?.state.status).toBe("failed")
    expect(yield* commands.get("replacement")).toBeUndefined()
  }),
)

Array.of("pending", "reported").forEach((status) =>
  it.live(`preserves ${status} failures when an earlier plugin changes`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const commands = yield* Command.Service
      const loads: string[] = []
      let fail = true
      const generation = (id: string, revision: string): Plugin.Generation => ({
        id,
        revision,
        effect: (ctx) =>
          Effect.gen(function* () {
            loads.push(`${id}@${revision}`)
            yield* ctx.command.transform((editor) => {
              editor.add({ name: id, execute: () => Effect.void })
              if (id === "broken" && fail) throw new Error("broken failed")
            })
          }),
      })
      const broken = generation("broken", "1")
      const later = generation("later", "1")
      yield* plugins.activate([generation("earlier", "1"), broken, later])
      if (status === "reported") yield* plugins.awaitActivation
      fail = false
      yield* plugins.activate([generation("earlier", "2"), broken, later])
      yield* plugins.awaitActivation
      expect(loads).toEqual(["earlier@1", "broken@1", "later@1", "earlier@2", "later@1"])
      const failed = (yield* plugins.list())[1]?.state
      expect(failed).toMatchObject({ status: "failed", ref: expect.stringMatching(/^err_/) })
      expect((yield* commands.list()).map((entry) => entry.name)).toEqual(["earlier", "later"])

      // Reordering and removing other plugins must preserve the same failure too.
      yield* plugins.activate([later, broken, generation("earlier", "2")])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[1]?.state).toEqual(failed)
      expect((yield* commands.list()).map((entry) => entry.name)).toEqual(["later", "earlier"])
      yield* plugins.activate([broken, later])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[0]?.state).toEqual(failed)
      expect(loads.filter((entry) => entry === "broken@1")).toHaveLength(1)

      yield* plugins.activate([generation("broken", "2"), later])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[0]?.state).toEqual({ status: "active" })
      expect(yield* commands.get("broken")).toBeDefined()
      expect(loads.filter((entry) => entry === "broken@2")).toHaveLength(1)
    }),
  ),
)

it.live("continues failure reporting and cleanup after a plugin update observer fails", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const bus = yield* Bus.Service
    const cleaned: string[] = []
    let fail = false
    let failPublication = true
    yield* plugins.activate(
      ["first", "second"].map((id) => ({
        id,
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => void cleaned.push(id)))
            yield* ctx.command.transform((editor) => {
              editor.add({ name: id, execute: () => Effect.void })
              if (fail) throw new Error(`${id} failed`)
            })
          }),
      })),
    )
    yield* Effect.acquireRelease(
      bus.listen((event) => {
        if (event.type !== Plugin.Event.Updated.type || !failPublication) return Effect.void
        failPublication = false
        return Effect.die("observer failed")
      }),
      (unsubscribe) => unsubscribe,
    )
    fail = true
    yield* commands.reload()
    const ready = yield* plugins.awaitActivation.pipe(Effect.timeout("250 millis"), Effect.exit)
    expect(Exit.isSuccess(ready)).toBe(true)
    expect((yield* plugins.list()).map((entry) => entry.state.status)).toEqual(["failed", "failed"])
    expect(cleaned.toSorted()).toEqual(["first", "second"])
    expect(yield* commands.list()).toEqual([])
  }),
)

const deny = (action: ConfigPolicy.Info["action"], resource: string): ConfigPolicy.Info => ({
  action,
  resource,
  effect: "deny",
})

// The real policy plugin, failing closed like the built-in, plus one more provider transform the test can make throw.
const activateFailingPolicy = Effect.fnUntraced(function* () {
  const plugins = yield* Plugin.Service
  // Only the services: the plugin must keep its activation Scope, which the full test context would replace.
  const services = Context.pick(
    Bus.Service,
    Config.Service,
    Credential.Service,
    WebSearch.Service,
  )(yield* Effect.context<Bus.Service | Config.Service | Credential.Service | WebSearch.Service>())
  const transform = { fail: false, thrown: 0 }
  yield* plugins.activate([
    {
      id: ConfigPolicyPlugin.Plugin.id,
      revision: "1",
      failClosed: true,
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* ConfigPolicyPlugin.Plugin.effect(ctx)
          yield* ctx.provider.transform(() => {
            if (!transform.fail) return
            transform.thrown++
            throw new Error("policy transform failed")
          })
        }).pipe(Effect.provide(services)),
    },
  ])
  return transform
})

it.live("keeps enforcing and updating org policy after a policy transform throws", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const catalog = yield* Provider.Service
    const hooks = yield* PluginHooks.Service
    const bus = yield* Bus.Service
    const config = yield* Config.Test
    yield* catalog.transform((editor) => {
      editor.update(Provider.ID.openai, () => {})
      editor.update(Provider.ID.anthropic, () => {})
    })
    const transform = yield* activateFailingPolicy()
    expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()

    transform.fail = true
    yield* bus.publish(Event.Updated, {})
    yield* waitUntil(Effect.sync(() => transform.thrown > 0))
    // Reads of the failing state fail rather than returning the provider the policy denies.
    expect(Exit.isFailure(yield* catalog.get(Provider.ID.openai).pipe(Effect.exit))).toBe(true)
    const evaluated = yield* hooks.trigger("permission", "evaluate", {
      sessionID: Session.ID.make("ses_policy"),
      action: "shell",
      resources: ["ls"],
      effect: "allow",
    })
    expect(evaluated.effect).toBe("deny")
    expect((yield* plugins.list())[0]?.state.status).toBe("active")

    transform.fail = false
    expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()
    expect(yield* catalog.get(Provider.ID.anthropic)).toBeDefined()

    // A deny added after recovery still applies.
    yield* config.setEntries([organizationPolicy([deny("provider.use", "openai"), deny("provider.use", "anthropic")])])
    yield* bus.publish(Event.Updated, {})
    yield* waitUntil(catalog.get(Provider.ID.anthropic).pipe(Effect.map((provider) => provider === undefined)))
  }).pipe(
    Effect.provide(
      Config.testLayer([organizationPolicy([deny("provider.use", "openai"), deny("tool.use", "shell:*")])]),
    ),
  ),
)

it.live("keeps applying account policy after a policy transform throws during a switch", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const credentials = yield* Credential.Service
    const account = (orgID: string) =>
      credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "access",
          refresh: "refresh",
          expires: Number.MAX_SAFE_INTEGER,
          metadata: { accountID: "acc_test", orgID },
        }),
      })
    const denied = yield* account("org_denied")
    yield* account("org_first")
    yield* catalog.transform((editor) => editor.update(Provider.ID.opencode, () => {}))
    const transform = yield* activateFailingPolicy()
    expect(yield* catalog.get(Provider.ID.opencode)).toBeDefined()

    transform.fail = true
    yield* account("org_second")
    yield* waitUntil(Effect.sync(() => transform.thrown > 0))
    transform.fail = false
    expect(yield* catalog.get(Provider.ID.opencode)).toBeDefined()

    // Switching to the denied account after recovery still revokes it.
    yield* credentials.activate(denied.id)
    yield* waitUntil(catalog.get(Provider.ID.opencode).pipe(Effect.map((provider) => provider === undefined)))
  }).pipe(Effect.provide(Config.testLayer([organizationPolicy([deny("integration.use", "opencode#org_denied")])]))),
)

it.live("keeps publishing provider and model updates after a provider read fails", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const bus = yield* Bus.Service
    const published = { provider: 0, model: 0 }
    const transform = { fail: false, thrown: 0 }
    yield* Effect.acquireRelease(
      bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === Provider.Event.Updated.type) published.provider++
          if (event.type === Model.Event.Updated.type) published.model++
        }),
      ),
      (unsubscribe) => unsubscribe,
    )
    // Registered outside any plugin, so it is ungrouped and rethrows from every read like a fail-closed transform.
    yield* catalog.transform(() => {
      if (!transform.fail) return
      transform.thrown++
      throw new Error("provider transform failed")
    })

    transform.fail = true
    yield* catalog.reload().pipe(Effect.exit)
    yield* bus.publish(Credential.Event.Switched, { integrationID: Integration.ID.make("test"), credentialID: null })
    yield* bus.publish(Provider.Event.Updated, {})
    // One throw from the reload, one from each observer.
    yield* waitUntil(Effect.sync(() => transform.thrown === 3))
    transform.fail = false

    published.model = 0
    yield* bus.publish(Provider.Event.Updated, {})
    yield* waitUntil(Effect.sync(() => published.model > 0))
    published.provider = 0
    yield* bus.publish(Credential.Event.Switched, { integrationID: Integration.ID.make("test"), credentialID: null })
    yield* waitUntil(Effect.sync(() => published.provider > 0))
  }),
)

it.live("settles readiness before shutdown joins a disabled plugin's finalizers", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const entered = yield* Deferred.make<void>()
    const escape = yield* Deferred.make<void>()
    let fail = false
    yield* plugins.activate([
      {
        id: "closing",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.command.transform((editor) => {
              editor.add({ name: "closing", execute: () => Effect.void })
              if (fail) throw new Error("closing failed")
            })
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(plugins.awaitActivation.pipe(Effect.raceFirst(Deferred.await(escape)))),
              ),
            )
          }),
      },
    ])
    fail = true
    const shutdown = yield* commands
      .reload()
      .pipe(Effect.andThen(plugins.close(Exit.void)), Effect.forkChild({ startImmediately: true }))
    yield* Deferred.await(entered)
    const result = yield* Fiber.join(shutdown).pipe(Effect.timeout("250 millis"), Effect.exit)
    // Release the fixture even on the old implementation, rather than hanging test teardown.
    yield* Deferred.succeed(escape, undefined)
    yield* Fiber.join(shutdown)
    expect(Exit.isSuccess(result)).toBe(true)
    const release = yield* plugins.hold()
    yield* plugins.awaitActivation
    let restarted = false
    yield* plugins.activate([
      { id: "after-close", revision: "1", effect: () => Effect.sync(() => void (restarted = true)) },
    ])
    yield* release
    expect(restarted).toBe(false)
  }),
)
