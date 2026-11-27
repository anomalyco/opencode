import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import type { PermissionDomain } from "@opencode/plugin/promise/permission"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "./fixture"

const asserted: Permission.AssertInput[] = []

// Answers by action so each test can pick the outcome the real service would produce.
const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: (input) => {
      asserted.push(input)
      if (input.action === "blocked")
        return Effect.fail(new Permission.BlockedError({ rules: [], permission: "blocked", resources: ["*"] }))
      if (input.action === "corrected") return Effect.fail(new Permission.CorrectedError({ feedback: "Use staging" }))
      if (input.action === "declined") return Effect.die(new Permission.DeclinedError())
      return Effect.void
    },
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    nested: () => Effect.void,
  }),
)

const it = testEffect(makePluginTestLayer(permission))
const withPermissions = testEffect(makePluginTestLayer(Permission.node))
const sessionID = Session.ID.make("ses_plugin_permission")

it.live("Effect plugins assert permissions and receive outcomes as tool errors", () =>
  Effect.gen(function* () {
    const host = yield* PluginHost.make(yield* Plugin.Service, "test")
    const assert = (action: string) =>
      host.permission.assert({ sessionID, action, resources: ["prod"], save: ["*"] }).pipe(Effect.exit)

    asserted.length = 0
    expect(Exit.isSuccess(yield* assert("deploy"))).toBe(true)
    expect(asserted).toEqual([{ sessionID, action: "deploy", resources: ["prod"], save: ["*"] }])

    const blocked = Option.getOrUndefined(Exit.findErrorOption(yield* assert("blocked")))
    expect(blocked).toBeInstanceOf(Tool.Error)
    expect(blocked).toMatchObject({ message: "Permission denied: blocked" })
    expect(blocked?.error).toBeInstanceOf(Permission.BlockedError)

    const corrected = Option.getOrUndefined(Exit.findErrorOption(yield* assert("corrected")))
    expect(corrected).toMatchObject({ message: "Use staging" })
    expect(corrected?.error).toBeInstanceOf(Permission.CorrectedError)

    const declined = yield* assert("declined")
    expect(
      Exit.isFailure(declined) &&
        declined.cause.reasons.some(
          (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
        ),
    ).toBe(true)
  }),
)

it.live("Promise plugins assert permissions with plain input", () =>
  Effect.gen(function* () {
    let assertPermission: PermissionDomain["assert"] = () => Promise.reject(new Error("Plugin did not start"))
    yield* PluginPromise.fromPromise({
      id: "promise-permission",
      async setup(context) {
        assertPermission = context.permission.assert
      },
    }).effect(yield* PluginHost.make(yield* Plugin.Service, "test"))
    const assert = (action: string) =>
      Effect.promise(() =>
        assertPermission({ sessionID: "ses_plugin_permission", action, resources: ["prod"] }).then(
          () => undefined,
          (error: unknown) => error,
        ),
      )

    asserted.length = 0
    expect(yield* assert("deploy")).toBeUndefined()
    expect(asserted).toEqual([{ sessionID, action: "deploy", resources: ["prod"] }])
    expect(yield* assert("corrected")).toMatchObject({ _tag: "Tool.Error", message: "Use staging" })
    expect(yield* assert("declined")).toBeInstanceOf(Permission.DeclinedError)
  }),
)

withPermissions.live("Promise tool assertions follow the calling tool's permissions and lifetime", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const bus = yield* Bus.Service
    const permissions = yield* Permission.Service
    const host = yield* PluginHost.make(plugins, "test")
    const session = yield* host.session.create({ permissions: [{ action: "deploy", resource: "*", effect: "allow" }] })
    yield* PluginPromise.fromPromise({
      id: "guarded-tool",
      async setup(context) {
        await context.permission.hook("evaluate", (event) => {
          if (event.action === "deploy") event.effect = "ask"
        })
        await context.tool.transform((editor) =>
          editor.add({
            name: "deploy",
            description: "Check deployment permission",
            input: Schema.Struct({}),
            async execute(_input, invocation) {
              await Promise.resolve()
              await context.permission.assert({
                sessionID: invocation.sessionID,
                action: "deploy",
                resources: ["staging"],
              })
              return { content: "approved" }
            },
          }),
        )
      },
    }).effect(host)

    const asked = yield* Deferred.make<void>()
    const unsubscribe = yield* bus.listen((event) =>
      event.type === Permission.Event.Asked.type ? Deferred.succeed(asked, undefined).pipe(Effect.asVoid) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const call = tools.check({
      code: "return await tools.deploy({})",
      tools: ["deploy"],
      bindings: {},
      limits: {},
      policy: Permission.Policy.fromRules(session.permissions ?? []),
      context: {
        sessionID: session.id,
        agent: Agent.defaultID,
        messageID: SessionMessage.ID.create(),
        progress: () => Effect.void,
      },
    })
    const unattended = (rules: Permission.Ruleset) =>
      call.pipe(
        Effect.provideService(Permission.Unattended, rules),
        Effect.raceFirst(Deferred.await(asked).pipe(Effect.andThen(Effect.die("Unexpected interactive request")))),
      )
    expect(yield* unattended([])).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("nobody is present") },
    })
    expect(yield* unattended([{ action: "deploy", resource: "staging", effect: "allow" }])).toMatchObject({
      ok: true,
      value: "approved",
    })

    const interactive = yield* call.pipe(Effect.forkScoped)
    yield* Deferred.await(asked)
    expect(yield* permissions.forSession(session.id)).toHaveLength(1)
    yield* Fiber.interrupt(interactive)
    expect(yield* permissions.forSession(session.id)).toEqual([])
  }),
)
