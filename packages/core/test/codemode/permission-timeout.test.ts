import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { Document } from "@opencode/schema/config"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Deferred, Effect, Fiber, Layer, Queue, Schema } from "effect"
import { TestClock } from "effect/testing"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

const sessionID = Session.ID.make("ses_codemode_permission_timeout")
const agentID = Agent.ID.make("test")
const flags = Flag.testLayer(
  [Schema.decodeUnknownSync(Document)({ type: "document", info: { experimental: { codemode_tool_timeouts: true } } })],
  { app: { channel: "latest" }, overrides: "" },
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      Database.node,
      Bus.node,
      SessionStore.node,
      PermissionSaved.node,
      Permission.node,
      Agent.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      Flag.node.replace(flags),
    ],
  ),
)

function fixture(afterApproval: Effect.Effect<string> = Effect.succeed("approved")) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: agentID,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(agentID, (agent) => {
        agent.permissions = []
      }),
    )
    const permission = yield* Permission.Service
    const saved = yield* PermissionSaved.Service
    const tools = yield* Tool.Service
    const actions: Array<string> = []
    yield* tools.transform((editor) =>
      editor.add({
        name: "protected",
        description: "Perform an action after approval",
        input: Schema.Struct({ resource: Schema.String }),
        output: Schema.String,
        execute: (input, context) =>
          Effect.gen(function* () {
            yield* permission.assert({
              action: "read",
              resources: [input.resource],
              save: ["*"],
              ...Permission.invocation(context),
            })
            actions.push(input.resource)
            return { output: yield* afterApproval }
          }).pipe(Effect.mapError((error) => new Tool.Error({ message: error.message }))),
      }),
    )
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
        sessionID,
        agent: agentID,
        messageID: SessionMessage.ID.create(),
        call: { type: "tool-call", id: "call-execute", name: "execute", input: { code } },
      })
    return { permission, saved, actions, asked, requests, replies, run }
  })
}

const catchTimeout = `
  try { await tools.protected({ resource: "expired" }, { timeoutMs: 100 }) }
  catch (error) { return { message: error.message, isError: error instanceof Error } }
  return "not caught"
`

describe("CodeMode permission deadlines", () => {
  it.effect("withdraws an unanswered approval and rejects late replies without saving a rule", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      expect(yield* state.permission.list()).toEqual([request])
      yield* TestClock.adjust(99)
      expect(fiber.pollUnsafe()).toBeUndefined()
      expect(state.actions).toEqual([])
      yield* TestClock.adjust(1)
      const result = yield* Fiber.join(fiber)
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
      expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "reject" }])
      expect(yield* state.permission.list()).toEqual([])
      for (const reply of ["once", "always"] as const)
        expect(yield* state.permission.reply({ requestID: request.id, reply }).pipe(Effect.flip)).toBeInstanceOf(
          Permission.NotFoundError,
        )
      expect(yield* state.saved.list()).toEqual([])
      expect(state.actions).toEqual([])
      expect(state.requests).toEqual([request])
    }),
  )

  it.effect("withdraws only the expired invocation while a sibling approval remains pending", () =>
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
      expect(fiber.pollUnsafe()).toBeUndefined()
      expect(yield* state.permission.list()).toEqual([sibling])
      expect(state.replies).toEqual([{ sessionID, requestID: expired.id, reply: "reject" }])
      expect(state.actions).toEqual([])
      yield* state.permission.reply({ requestID: sibling.id, reply: "once" })
      const result = yield* Fiber.join(fiber)
      expect(JSON.stringify(result.content)).toContain("approval timed out")
      expect(JSON.stringify(result.content)).toContain("approved")
      expect(state.actions).toEqual(["sibling"])
      expect(yield* state.saved.list()).toEqual([])
    }),
  )

  it.effect("requires fresh approval when the model requests a new attempt after expiry", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const first = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const expired = yield* Queue.take(state.asked)
      yield* TestClock.adjust(100)
      yield* Fiber.join(first)
      expect(state.replies).toEqual([{ sessionID, requestID: expired.id, reply: "reject" }])
      expect(state.requests).toEqual([expired])
      const retry = yield* state
        .run('return await tools.protected({ resource: "expired" }, { timeoutMs: 100 })')
        .pipe(Effect.forkChild({ startImmediately: true }))
      const fresh = yield* Queue.take(state.asked)
      expect(fresh.id).not.toBe(expired.id)
      expect(yield* state.permission.list()).toEqual([fresh])
      expect(state.actions).toEqual([])
      yield* state.permission.reply({ requestID: fresh.id, reply: "once" })
      expect((yield* Fiber.join(retry)).content).toEqual([{ type: "text", text: "approved" }])
      expect(state.actions).toEqual(["expired"])
      expect(yield* state.saved.list()).toEqual([])
    }),
  )

  it.effect("runs the protected action when approval arrives before expiry", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state
        .run('return await tools.protected({ resource: "approved" }, { timeoutMs: 100 })')
        .pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* TestClock.adjust(99)
      yield* state.permission.reply({ requestID: request.id, reply: "once" })
      expect((yield* Fiber.join(fiber)).content).toEqual([{ type: "text", text: "approved" }])
      yield* TestClock.adjust(1)
      expect(state.actions).toEqual(["approved"])
      expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "once" }])
      expect(yield* state.permission.list()).toEqual([])
    }),
  )

  it.effect("keeps explicit user denial distinct from approval expiry", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* state.permission.reply({ requestID: request.id, reply: "reject" })
      const result = yield* Fiber.join(fiber)
      expect(JSON.stringify(result.content)).toContain("Permission.DeclinedError")
      expect(JSON.stringify(result.content)).not.toContain("timed out")
      expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "reject" }])
      expect(state.actions).toEqual([])
    }),
  )

  it.effect("consumes an accepted approval before publishing so expiry cannot relabel it as unanswered", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const accepted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Replied.type &&
        (event.data as typeof Permission.Event.Replied.data.Type).reply === "once"
          ? Deferred.succeed(accepted, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      const reply = yield* state.permission
        .reply({ requestID: request.id, reply: "once" })
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* Effect.gen(function* () {
        yield* Deferred.await(accepted)
        expect(yield* state.permission.get(request.id)).toBeUndefined()
        yield* TestClock.adjust(100)
        expect((yield* Fiber.join(fiber)).content).toEqual([
          {
            type: "text",
            text: JSON.stringify({ message: "Tool 'protected' timed out after 100ms.", isError: true }),
          },
        ])
        expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "once" }])
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      yield* Fiber.join(reply)
      expect(state.actions).toEqual([])
    }),
  )
  ;(["reject", "always"] as const).forEach((reply) =>
    it.effect(`consumes a sibling's accepted ${reply} decision before publishing it`, () =>
      Effect.gen(function* () {
        const state = yield* fixture()
        const fiber = yield* state
          .run(
            `
            const results = await Promise.allSettled([
              tools.protected({ resource: "primary" }, { timeoutMs: 1000 }),
              tools.protected({ resource: "sibling" }, { timeoutMs: 100 }),
            ])
            return results.map(result => result.status === "fulfilled"
              ? result : { status: result.status, message: result.reason.message })
          `,
          )
          .pipe(Effect.forkChild({ startImmediately: true }))
        const primary = yield* Queue.take(state.asked)
        const sibling = yield* Queue.take(state.asked)
        const accepted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const bus = yield* Bus.Service
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Replied.type &&
          (event.data as typeof Permission.Event.Replied.data.Type).requestID === sibling.id
            ? Deferred.succeed(accepted, undefined).pipe(Effect.andThen(Deferred.await(release)))
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const decision = yield* state.permission
          .reply({ requestID: primary.id, reply })
          .pipe(Effect.forkChild({ startImmediately: true }))
        yield* Effect.gen(function* () {
          yield* Deferred.await(accepted)
          yield* TestClock.adjust(100)
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
        yield* Fiber.join(decision)
        const text = JSON.stringify((yield* Fiber.join(fiber)).content)
        expect(text).toContain("Tool 'protected' timed out after 100ms.")
        expect(text).not.toContain("approval timed out")
        expect(state.replies).toEqual([
          { sessionID, requestID: primary.id, reply },
          { sessionID, requestID: sibling.id, reply },
        ])
        expect(yield* state.permission.list()).toEqual([])
        expect(state.actions).toEqual(reply === "always" ? ["primary"] : [])
      }),
    ),
  )

  it.effect("withdraws approval on manual stop without converting interruption into a timeout", () =>
    Effect.gen(function* () {
      const state = yield* fixture()
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "reject" }])
      expect(yield* state.permission.list()).toEqual([])
      expect(state.actions).toEqual([])
    }),
  )

  it.effect("keeps post-approval execution expiry as an ordinary tool timeout", () =>
    Effect.gen(function* () {
      const state = yield* fixture(Effect.never)
      const fiber = yield* state.run(catchTimeout).pipe(Effect.forkChild({ startImmediately: true }))
      const request = yield* Queue.take(state.asked)
      yield* state.permission.reply({ requestID: request.id, reply: "once" })
      yield* TestClock.adjust(100)
      const result = yield* Fiber.join(fiber)
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({ message: "Tool 'protected' timed out after 100ms.", isError: true }),
        },
      ])
      expect(state.actions).toEqual(["expired"])
      expect(state.replies).toEqual([{ sessionID, requestID: request.id, reply: "once" }])
    }),
  )
})
