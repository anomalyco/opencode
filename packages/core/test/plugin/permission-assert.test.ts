import { expect } from "bun:test"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import type { PermissionDomain } from "@opencode/plugin/promise/permission"
import { Session } from "@opencode/schema/session"
import { Cause, Effect, Exit, Layer, Option } from "effect"
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
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

const it = testEffect(makePluginTestLayer(permission))
const sessionID = Session.ID.make("ses_plugin_permission")

it.live("Effect plugins assert permissions and receive outcomes as tool errors", () =>
  Effect.gen(function* () {
    const host = yield* PluginHost.make(yield* Plugin.Service)
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
    }).effect(yield* PluginHost.make(yield* Plugin.Service))
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
