import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionTable } from "@opencode/core/permission/sql"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import type { PermissionDomain } from "@opencode/plugin/promise/permission"
import { Document } from "@opencode/schema/config"
import { Cause, Deferred, Effect, Fiber, Queue, Schema } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "./fixture"

const it = testEffect(makePluginTestLayer(null))

function fixture(
  options: {
    beforeApproval?: Promise<void>
    hook?: "execute.before" | "execute.after"
    borrowed?: boolean
  } = {},
) {
  return Effect.gen(function* () {
    const config = yield* Config.Test
    yield* config.setEntries([
      Schema.decodeUnknownSync(Document)({
        type: "document",
        info: { experimental: { codemode_tool_timeouts: true } },
      }),
    ])
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: location.directory }),
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    })
    const permission = yield* Permission.Service
    const tools = yield* Tool.Service
    const plugins = yield* Plugin.Service
    const actions: Array<string> = []
    const hookActions: Array<string> = []
    const completions = new Map<string, Promise<unknown>>()
    const started = yield* Queue.unbounded<string>()
    if (options.borrowed)
      yield* tools.transform((editor) =>
        editor.add({
          name: "original",
          description: "Existing Effect tool requiring approval",
          input: Schema.Struct({ resource: Schema.String }),
          output: Schema.String,
          execute: (input, context) =>
            permission
              .assert({
                ...Permission.invocation(context),
                action: "read",
                resources: [input.resource],
                save: ["*"],
              })
              .pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    actions.push(input.resource)
                    return { output: "approved" }
                  }),
                ),
                Effect.mapError((error) => new Tool.Error({ message: error.message })),
              ),
        }),
      )
    let assertOutside: PermissionDomain["assert"] = () => Promise.reject(new Error("Plugin did not start"))
    yield* PluginPromise.fromPromise({
      id: "permission-timeout",
      async setup(context) {
        assertOutside = context.permission.assert
        if (options.hook)
          await context.tool.hook(options.hook, async (event) => {
            if (event.tool !== "protected") return
            await context.permission.assert({
              sessionID: event.sessionID,
              agent: event.agent,
              source: { type: "tool", messageID: event.messageID, id: event.id },
              action: "read",
              resources: [event.tool],
              save: ["*"],
            })
            hookActions.push(event.tool)
          })
        const original = options.borrowed
          ? (await context.tool.list()).find((tool) => tool.name === "original")
          : undefined
        if (options.borrowed && !original) throw new Error("Original Effect tool was not registered")
        await context.tool.transform((editor) =>
          editor.add({
            name: "protected",
            description: "Perform an action after Promise-plugin approval",
            input: Schema.Struct({ resource: Schema.String }),
            output: Schema.String,
            execute: (input, invocation) => {
              const running = Promise.resolve(options.beforeApproval).then(async () => {
                if (original) return original.execute(input, invocation)
                if (!options.hook)
                  await context.permission.assert({
                    sessionID: invocation.sessionID,
                    agent: invocation.agent,
                    source: { type: "tool", messageID: invocation.messageID, id: invocation.id },
                    action: "read",
                    resources: [input.resource],
                    save: ["*"],
                  })
                actions.push(input.resource)
                return { output: "approved" }
              })
              completions.set(
                input.resource,
                running.then(
                  () => undefined,
                  (error: unknown) => error,
                ),
              )
              Effect.runSync(Queue.offer(started, input.resource))
              return running
            },
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins, "test"))
    const asked = yield* Queue.unbounded<Permission.Request>()
    const requests: Array<Permission.Request> = []
    const replies: Array<unknown> = []
    const bus = yield* Bus.Service
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type === Permission.Event.Asked.type) {
        const request = event.data as Permission.Request
        requests.push(request)
        return Queue.offer(asked, request).pipe(Effect.asVoid)
      }
      if (event.type === Permission.Event.Replied.type) replies.push(event.data)
      return Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const snapshot = yield* tools.snapshot()
    const run = (code: string) =>
      snapshot.execute({
        sessionID: session.id,
        agent: Agent.defaultID,
        messageID: SessionMessage.ID.create(),
        call: { type: "tool-call", id: "call-execute", name: "execute", input: { code } },
      })
    const completed = (resource: string) =>
      Effect.promise(() => completions.get(resource) ?? Promise.reject(new Error(`Tool '${resource}' did not start`)))
    const database = yield* Database.Service
    return {
      permission,
      actions,
      hookActions,
      started,
      asked,
      requests,
      replies,
      run,
      completed,
      saved: database.db.select().from(PermissionTable).all().pipe(Effect.orDie),
      assertOutside: (resource: string) =>
        Effect.promise(() => assertOutside({ sessionID: session.id, action: "read", resources: [resource] })),
    }
  })
}

const catchTimeout = `
  try { await tools.protected({ resource: "expired" }, { timeoutMs: 100 }) }
  catch (error) { return { message: error.message, isError: error instanceof Error } }
  return "not caught"
`

describe("Promise-plugin permission deadlines", () => {
  for (const hook of ["execute.before", "execute.after"] as const)
    it.effect(`withdraws approval awaited by a Promise ${hook} hook`, () =>
      Effect.gen(function* () {
        const state = yield* fixture({ hook })
        const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
        const request = yield* Queue.take(state.asked)
        expect(request.resources).toEqual(["protected"])
        yield* TestClock.adjust(100)
        const result = yield* Fiber.join(fiber)
        expect(yield* state.permission.list()).toEqual([])
        expect(JSON.stringify(result.content)).toContain("approval timed out")
        for (const reply of ["once", "always"] as const)
          expect(yield* state.permission.reply({ requestID: request.id, reply }).pipe(Effect.flip)).toBeInstanceOf(
            Permission.NotFoundError,
          )
        expect(state.actions).toEqual(hook === "execute.before" ? [] : ["expired"])
        expect(state.hookActions).toEqual([])
        expect(yield* state.saved).toEqual([])
      }),
    )

  it.effect("preserves the invocation context while a Promise wrapper awaits an existing Effect tool", () =>
    Effect.gen(function* () {
      const state = yield* fixture({ borrowed: true })
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* TestClock.adjust(100)
      const result = yield* Fiber.join(fiber)
      expect(JSON.stringify(result.content)).toContain("approval timed out")
      expect(yield* state.permission.list()).toEqual([])
      expect(state.replies).toEqual([{ sessionID: request.sessionID, requestID: request.id, reply: "reject" }])
      for (const reply of ["once", "always"] as const)
        expect(yield* state.permission.reply({ requestID: request.id, reply }).pipe(Effect.flip)).toBeInstanceOf(
          Permission.NotFoundError,
        )
      expect(yield* state.saved).toEqual([])
      expect(state.actions).toEqual([])
    }),
  )

  it.effect("withdraws an awaited approval before returning the specific timeout and rejects late approvals", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* TestClock.adjust(99)
      expect(fiber.pollUnsafe()).toBeUndefined()
      expect(yield* state.permission.list()).toEqual([request])
      yield* TestClock.adjust(1)
      const result = yield* Fiber.join(fiber)
      expect(yield* state.permission.list()).toEqual([])
      expect(state.replies).toEqual([{ sessionID: request.sessionID, requestID: request.id, reply: "reject" }])
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({
            message:
              "Tool 'protected' approval timed out after 100ms: no approval received, not an explicit user denial. The action awaiting approval did not run. You may request approval again or wait for the user. A retry requires fresh approval.",
            isError: true,
          }),
        },
      ])
      for (const reply of ["once", "always"] as const)
        expect(yield* state.permission.reply({ requestID: request.id, reply }).pipe(Effect.flip)).toBeInstanceOf(
          Permission.NotFoundError,
        )
      expect(yield* state.saved).toEqual([])
      expect(yield* state.completed("expired")).toBeDefined()
      expect(state.actions).toEqual([])
      expect(state.requests).toEqual([request])
    }),
  )

  it.effect("keeps concurrent Promise approval siblings isolated", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state
        .run(
          `
          const results = await Promise.allSettled([
            tools.protected({ resource: "expired" }, { timeoutMs: 100 }),
            tools.protected({ resource: "sibling" }, { timeoutMs: 1000 }),
          ])
          return results.map(result => result.status === "fulfilled"
            ? result : { status: result.status, message: result.reason.message })
        `,
        )
        .pipe(Effect.forkChild({ startImmediately: true }))
      const expired = yield* Queue.take(state.asked)
      const sibling = yield* Queue.take(state.asked)
      expect(expired.resources).toEqual(["expired"])
      expect(sibling.resources).toEqual(["sibling"])
      yield* TestClock.adjust(100)
      expect(yield* state.permission.list()).toEqual([sibling])
      expect(state.replies).toEqual([{ sessionID: expired.sessionID, requestID: expired.id, reply: "reject" }])
      expect(state.actions).toEqual([])
      yield* state.permission.reply({ requestID: sibling.id, reply: "once" })
      const result = yield* Fiber.join(fiber)
      expect(JSON.stringify(result.content)).toContain("approval timed out")
      expect(JSON.stringify(result.content)).toContain("approved")
      expect(state.actions).toEqual(["sibling"])
      expect(yield* state.saved).toEqual([])
    }),
  )

  it.effect("waits for permission withdrawal publication before completing the outer timeout", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const publishing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Replied.type &&
        (event.data as typeof Permission.Event.Replied.data.Type).reply === "reject"
          ? Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Queue.take(state.asked)
      yield* Effect.gen(function* () {
        yield* TestClock.adjust(100)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* Deferred.await(publishing)
        expect(state.actions).toEqual([])
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      expect(JSON.stringify((yield* Fiber.join(fiber)).content)).toContain("approval timed out")
    }),
  )

  it.effect("withdraws Promise approval on manual cancellation while preserving interruption", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* state.permission.list()).toEqual([])
      expect(state.replies).toEqual([{ sessionID: request.sessionID, requestID: request.id, reply: "reject" }])
      expect(yield* state.completed("expired")).toBeDefined()
      expect(state.actions).toEqual([])
    }),
  )

  it.effect("rejects a permission assertion started after its Promise invocation was aborted", () =>
    Effect.gen(function* () {
      const release = Promise.withResolvers<void>()
      const state = yield* fixture({ beforeApproval: release.promise })
      const fiber = yield* state
        .run('return await tools.protected({ resource: "late" }, { timeoutMs: 100 })')
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Queue.take(state.started)
      yield* TestClock.adjust(100)
      const result = yield* Fiber.join(fiber)
      expect(JSON.stringify(result.content)).toContain("Tool 'protected' timed out after 100ms.")
      release.resolve()
      expect(
        yield* Effect.raceFirst(
          Queue.take(state.asked).pipe(Effect.as("asked")),
          state.completed("late").pipe(Effect.as("rejected")),
        ),
      ).toBe("rejected")
      expect(yield* state.completed("late")).toBeDefined()
      expect(yield* state.permission.list()).toEqual([])
      expect(state.requests).toEqual([])
      expect(state.actions).toEqual([])
    }),
  )

  it.effect("preserves explicit decline for an awaited Promise permission", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* state.permission.reply({ requestID: request.id, reply: "reject" })
      const result = yield* Fiber.join(fiber)
      expect(yield* state.completed("expired")).toBeInstanceOf(Permission.DeclinedError)
      expect(JSON.stringify(result.content)).not.toContain("timed out")
      expect(state.actions).toEqual([])
      expect(yield* state.permission.list()).toEqual([])
    }),
  )

  it.effect("preserves Promise permission assertions outside a tool invocation", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const assertion = yield* state.assertOutside("outside").pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      expect(request.resources).toEqual(["outside"])
      yield* state.permission.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(assertion)
      expect(yield* state.permission.list()).toEqual([])
      expect(state.actions).toEqual([])
    }),
  )
})
