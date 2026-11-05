import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Agent } from "@opencode/core/agent"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionTable } from "@opencode/core/permission/sql"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { ShellParse } from "@opencode/core/shell/parse"
import { eq, sql } from "drizzle-orm"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      Permission.node,
      PluginHooks.node,
    ]),
    [Location.node.replace(current)],
  ),
)

function setup(rules: Permission.Ruleset = [], sessionID = Session.ID.make("ses_test")) {
  return Effect.gen(function* () {
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
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: Agent.ID.make("test"),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* setRules(rules)
  })
}

function setRules(rules: Permission.Ruleset) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
  })
}

function assertion(input: Partial<Permission.AssertInput> = {}) {
  return {
    id: Permission.ID.create("per_test"),
    sessionID: Session.ID.make("ses_test"),
    action: "read",
    resources: ["src/index.ts"],
    ...input,
  } satisfies Permission.AssertInput
}

function waitForRequest(input: Partial<Permission.AssertInput> = {}) {
  return Effect.gen(function* () {
    const value = assertion(input)
    const service = yield* Permission.Service
    const bus = yield* Bus.Service
    const asked = yield* Deferred.make<Permission.Request>()
    const unsubscribe = yield* bus.listen((event) => {
      if (event.type !== Permission.Event.Asked.type) return Effect.void
      const request = event.data as Permission.Request
      return request.id === value.id ? Deferred.succeed(asked, request).pipe(Effect.asVoid) : Effect.void
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* service.assert(value).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { service, fiber, request }
  })
}

function holdReply(requestID: Permission.ID) {
  return Effect.gen(function* () {
    const bus = yield* Bus.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const replies: Array<{ requestID: Permission.ID; reply: Permission.Reply }> = []
    const unsubscribe = yield* bus.listen((event) =>
      Effect.gen(function* () {
        if (event.type !== Permission.Event.Replied.type) return
        const data = event.data as { requestID: Permission.ID; reply: Permission.Reply }
        replies.push(data)
        if (data.requestID !== requestID || (yield* Deferred.isDone(entered))) return
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    return { entered, release, replies }
  })
}

function expectNotFound(exit: Exit.Exit<void, Permission.NotFoundError>, requestID: Permission.ID) {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.NotFoundError)
    expect(Cause.squash(exit.cause)).toMatchObject({ requestID })
  }
}

describe("Permission settlement", () => {
  for (const first of ["once", "reject"] as const) {
    it.effect(`settles once when ${first} races another reply`, () =>
      Effect.gen(function* () {
        yield* setup()
        const { service, request, fiber } = yield* waitForRequest()
        const gate = yield* holdReply(request.id)
        const winner = yield* service.reply({ requestID: request.id, reply: first }).pipe(Effect.forkScoped)
        yield* Deferred.await(gate.entered)
        const loser = yield* service
          .reply({ requestID: request.id, reply: first === "once" ? "reject" : "once" })
          .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
        const immediate = loser.pollUnsafe()
        yield* Deferred.succeed(gate.release, undefined)
        yield* Fiber.join(winner)
        const result = yield* Fiber.join(loser)
        expect(immediate).toBeDefined()
        expectNotFound(result, request.id)
        expect(gate.replies.map((event) => event.reply)).toEqual([first])
        const settled = yield* Fiber.await(fiber)
        expect(settled._tag).toBe(first === "once" ? "Success" : "Failure")
        expect(yield* service.list()).toEqual([])
      }),
    )
  }

  it.effect("returns NotFound to an inline listener replying to the same ID", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, request, fiber } = yield* waitForRequest()
      const bus = yield* Bus.Service
      const results: Array<Exit.Exit<void, Permission.NotFoundError>> = []
      let calls = 0
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Permission.Event.Replied.type) return
          calls++
          if (calls > 1) return
          results.push(yield* service.reply({ requestID: request.id, reply: "reject" }).pipe(Effect.exit))
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* service.reply({ requestID: request.id, reply: "once" })
      const settled = yield* Fiber.await(fiber)
      expect(results).toHaveLength(1)
      results.forEach((result) => expectNotFound(result, request.id))
      expect(calls).toBe(1)
      expect(settled._tag).toBe("Success")
      expect(yield* service.list()).toEqual([])
    }),
  )

  for (const response of ["reject", "always"] as const) {
    it.effect(`settles the ${response} cascade target once against an explicit reply`, () =>
      Effect.gen(function* () {
        yield* setup()
        const selected = yield* waitForRequest({ save: ["src/*"] })
        const target = yield* waitForRequest({ id: Permission.ID.create("per_target") })
        const gate = yield* holdReply(target.request.id)
        yield* Effect.gen(function* () {
          const cascade = yield* selected.service
            .reply({ requestID: selected.request.id, reply: response })
            .pipe(Effect.forkScoped)
          yield* Deferred.await(gate.entered)
          const reply = yield* target.service
            .reply({ requestID: target.request.id, reply: "once" })
            .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }))
          const immediate = reply.pollUnsafe()
          yield* Deferred.succeed(gate.release, undefined)
          yield* Fiber.join(cascade)
          expect(immediate).toBeDefined()
          expectNotFound(yield* Fiber.join(reply), target.request.id)
          expect(gate.replies.map((event) => [event.requestID, event.reply])).toEqual([
            [selected.request.id, response],
            [target.request.id, response],
          ])
          expect((yield* Fiber.await(selected.fiber))._tag).toBe(response === "reject" ? "Failure" : "Success")
          expect((yield* Fiber.await(target.fiber))._tag).toBe(response === "reject" ? "Failure" : "Success")
          expect(yield* selected.service.list()).toEqual([])
        }).pipe(Effect.ensuring(Deferred.succeed(gate.release, undefined)))
      }),
    )
  }

  it.effect("skips an always target settled while its evaluation is suspended", () =>
    Effect.gen(function* () {
      yield* setup()
      const selected = yield* waitForRequest({ save: ["src/*"] })
      const target = yield* waitForRequest({
        id: Permission.ID.create("per_target"),
        resources: ["src/target.ts"],
      })
      const hooks = yield* PluginHooks.Service
      const evaluating = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* hooks.register("permission", "evaluate", (event) =>
        event.resources.includes("src/target.ts")
          ? Deferred.succeed(evaluating, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )
      const events = yield* holdReply(Permission.ID.create("per_unused"))
      const always = yield* selected.service
        .reply({ requestID: selected.request.id, reply: "always" })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(evaluating)
      yield* target.service.reply({ requestID: target.request.id, reply: "once" })
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(always)
      yield* Fiber.join(selected.fiber)
      yield* Fiber.join(target.fiber)
      expect(events.replies.map((event) => [event.requestID, event.reply])).toEqual([
        [selected.request.id, "always"],
        [target.request.id, "once"],
      ])
      expect(yield* selected.service.list()).toEqual([])
    }),
  )

  it.effect("closes without rejecting a request whose reply is publishing", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, request, fiber } = yield* waitForRequest()
      const gate = yield* holdReply(request.id)
      const reply = yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.forkScoped)
      yield* Deferred.await(gate.entered)
      const close = yield* service.close.pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate.release, undefined)
      yield* Fiber.join(reply)
      yield* Fiber.join(close)
      const settled = yield* Fiber.await(fiber)
      expect(gate.replies.map((event) => event.reply)).toEqual(["once"])
      expect(settled._tag).toBe("Success")
      expect(yield* service.list()).toEqual([])
      expect(yield* service.ask(assertion({ id: Permission.ID.create("per_closed") }))).toMatchObject({
        effect: "deny",
      })
    }),
  )

  it.effect("closes an ask-only request once when close overlaps close", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const request = assertion()
      yield* service.ask(request)
      const gate = yield* holdReply(request.id)
      const first = yield* service.close.pipe(Effect.forkScoped)
      yield* Deferred.await(gate.entered)
      const second = yield* service.close.pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(gate.release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(gate.replies.map((event) => event.reply)).toEqual(["reject"])
      expect(yield* service.list()).toEqual([])
      expect(yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
    }),
  )

  it.effect("clears ask-only requests when close publication fails", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const request = assertion()
      yield* service.ask(request)
      const bus = yield* Bus.Service
      const defect = new Error("permission close publication failed")
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Replied.type ? Effect.die(defect) : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const result = yield* service.close.pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result))
        expect(result.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
      expect(yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
    }),
  )

  it.effect("retries a reply after publication fails", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, request, fiber } = yield* waitForRequest()
      const bus = yield* Bus.Service
      const defect = new Error("permission publication failed")
      let attempts = 0
      // Permission replies are ephemeral, so inline listener failures propagate through publish.
      const unsubscribe = yield* bus.listen((event) =>
        Effect.suspend(() => {
          if (event.type !== Permission.Event.Replied.type) return Effect.void
          attempts++
          return attempts === 1 ? Effect.die(defect) : Effect.void
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const events = yield* holdReply(Permission.ID.create("per_unused"))
      const failed = yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed))
        expect(failed.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true)
      expect(yield* service.get(request.id)).toEqual(request)
      expect(fiber.pollUnsafe()).toBeUndefined()
      expect(events.replies).toEqual([])
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(attempts).toBe(2)
      expect(events.replies.map((event) => event.reply)).toEqual(["once"])
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("retries always after saving an approval defects", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, request, fiber } = yield* waitForRequest({ save: ["src/*"] })
      const { db } = yield* Database.Service
      const saved = yield* PermissionSaved.Service
      yield* db.run(
        sql`CREATE TRIGGER fail_permission_save BEFORE INSERT ON permission BEGIN SELECT RAISE(ABORT, 'permission saved insert failed'); END`,
      )
      yield* Effect.gen(function* () {
        const failed = yield* service.reply({ requestID: request.id, reply: "always" }).pipe(Effect.exit)
        expect(Exit.isFailure(failed)).toBe(true)
        if (Exit.isFailure(failed)) {
          expect(failed.cause.reasons.some(Cause.isDieReason)).toBe(true)
          expect(Cause.pretty(failed.cause)).toContain("permission saved insert failed")
        }
        expect(yield* service.get(request.id)).toEqual(request)
        expect(yield* service.list()).toEqual([request])
        expect(fiber.pollUnsafe()).toBeUndefined()
        expect(yield* saved.list()).toEqual([])
      }).pipe(Effect.ensuring(db.run(sql`DROP TRIGGER fail_permission_save`).pipe(Effect.orDie)))
      yield* service.reply({ requestID: request.id, reply: "always" })
      yield* Fiber.join(fiber)
      expect(yield* saved.list()).toMatchObject([{ action: "read", resource: "src/*" }])
      expect(yield* service.list()).toEqual([])
      expect(yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
    }),
  )

  for (const mode of ["assert", "ask"] as const) {
    it.effect(`cleans up ${mode} when publication defects after close skips its active reply`, () =>
      Effect.gen(function* () {
        yield* setup()
        const service = yield* Permission.Service
        const request = assertion()
        const waiting = mode === "assert" ? yield* waitForRequest(request) : undefined
        if (mode === "ask") yield* service.ask(request)
        const gate = yield* holdReply(request.id)
        const bus = yield* Bus.Service
        const defect = new Error("active permission publication failed")
        const unsubscribe = yield* bus.listen((event) =>
          event.type === Permission.Event.Replied.type ? Effect.die(defect) : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* Effect.gen(function* () {
          const publisher = yield* service
            .reply({ requestID: request.id, reply: "once" })
            .pipe(Effect.exit, Effect.forkScoped)
          yield* Deferred.await(gate.entered)
          yield* service.close
          expect(publisher.pollUnsafe()).toBeUndefined()
          expect(gate.replies.map((event) => event.reply)).toEqual(["once"])
          yield* Deferred.succeed(gate.release, undefined)
          const failed = yield* Fiber.join(publisher)
          expect(Exit.isFailure(failed)).toBe(true)
          if (Exit.isFailure(failed))
            expect(failed.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(
              true,
            )
          if (waiting) {
            const settled = yield* Fiber.await(waiting.fiber)
            expect(Exit.isFailure(settled)).toBe(true)
            if (Exit.isFailure(settled))
              expect(
                settled.cause.reasons.some(
                  (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
                ),
              ).toBe(true)
          }
          expect(yield* service.list()).toEqual([])
          expect(yield* service.get(request.id)).toBeUndefined()
          expect(yield* service.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
            Permission.NotFoundError,
          )
          expect(gate.replies.map((event) => event.reply)).toEqual(["once"])
        }).pipe(Effect.ensuring(Deferred.succeed(gate.release, undefined)))
      }),
    )
  }

  it.effect("replies in another Session while one request is publishing", () =>
    Effect.gen(function* () {
      yield* setup()
      yield* setup([], Session.ID.make("ses_other"))
      const selected = yield* waitForRequest()
      const other = yield* waitForRequest({
        id: Permission.ID.create("per_other"),
        sessionID: Session.ID.make("ses_other"),
      })
      const gate = yield* holdReply(selected.request.id)
      const first = yield* selected.service
        .reply({ requestID: selected.request.id, reply: "once" })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(gate.entered)
      yield* other.service
        .reply({ requestID: other.request.id, reply: "once" })
        .pipe(Effect.ensuring(Deferred.succeed(gate.release, undefined)))
      yield* Fiber.join(other.fiber)
      yield* Fiber.join(first)
      yield* Fiber.join(selected.fiber)
      expect(gate.replies.map((event) => event.requestID)).toEqual([selected.request.id, other.request.id])
      expect(yield* selected.service.list()).toEqual([])
    }),
  )
})

describe("Permission", () => {
  it.effect("returns the evaluated effect and only queues prompts", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
      yield* setRules([])
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("evaluates against an explicit agent", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions.push({ action: "read", resource: "*", effect: "deny" })
        }),
      )
      const service = yield* Permission.Service

      expect(yield* service.ask(assertion())).toMatchObject({ effect: "allow" })
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "deny" })
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.permissions = []
        }),
      )
      expect(yield* service.ask(assertion({ agent: Agent.ID.make("reviewer") }))).toMatchObject({ effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).not.toHaveProperty("agent")
    }),
  )

  it.effect("allows and denies from explicit rules without asking", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      yield* service.assert(assertion())
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      const blocked = yield* service.assert(assertion()).pipe(Effect.flip)
      expect(blocked).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("checks for a deny without asking", () =>
    Effect.gen(function* () {
      yield* setup([])
      const service = yield* Permission.Service
      yield* service.assertNotDenied(assertion())
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.assertNotDenied(assertion()).pipe(Effect.flip)).toBeInstanceOf(Permission.BlockedError)
    }),
  )

  it.effect("reports whether a request is already allowed without asking", () =>
    Effect.gen(function* () {
      yield* setup([])
      const service = yield* Permission.Service
      expect(yield* service.allows(assertion())).toBe(false)
      expect(yield* service.list()).toEqual([])
      yield* setRules([{ action: "read", resource: "*", effect: "allow" }])
      expect(yield* service.allows(assertion())).toBe(true)
      yield* setRules([{ action: "read", resource: "*", effect: "deny" }])
      expect(yield* service.allows(assertion())).toBe(false)
    }),
  )

  test("matches Windows rule resources against slash-normalized file access resources", () => {
    const rules: Permission.Ruleset = [
      { action: "external_directory", resource: "C:\\Users\\x\\proj\\*", effect: "allow" },
    ]
    expect(Permission.evaluate("external_directory", "C:/Users/x/proj/src/*", rules).effect).toBe("allow")
    expect(Permission.evaluate("external_directory", "C:/Users/x/other/*", rules).effect).toBe("ask")
  })

  it.effect("allows managed output reads without granting external directory access", () =>
    Effect.gen(function* () {
      yield* setup([
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
      ])
      const service = yield* Permission.Service

      expect(yield* service.ask(assertion({ resources: ["tool_123"] }))).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ action: "external_directory", resources: ["/tmp/tool-output/*"] })),
      ).toMatchObject({ effect: "deny" })
    }),
  )

  it.effect("uses build permissions when the Session agent is omitted", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions = [{ action: "custom", resource: "*", effect: "allow" }]
        }),
      )

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "custom", resources: ["*"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("denies omitted-agent permissions when no primary default agent exists", () =>
    Effect.gen(function* () {
      yield* setup()
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: null })
        .where(eq(SessionTable.id, Session.ID.make("ses_test")))
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.remove(Agent.ID.make("test"))
        editor.remove(Agent.ID.make("build"))
      })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion())).toEqual({ id: Permission.ID.create("per_test"), effect: "deny" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("evaluates bash with the normal configured-rule semantics", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service
      const bash = assertion({ action: "bash", resources: ["pwd"] })
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "allow" })

      yield* setRules([])
      expect(yield* service.ask(bash)).toEqual({ id: Permission.ID.create("per_test"), effect: "ask" })
      expect(yield* service.get(Permission.ID.create("per_test"))).toBeDefined()
    }),
  )

  it.effect("merges session rules after agent rules and before saved approvals", () =>
    Effect.gen(function* () {
      yield* setup([{ action: "*", resource: "*", effect: "allow" }])
      const { db } = yield* Database.Service
      const service = yield* Permission.Service
      const setSession = (permission: Permission.Ruleset) =>
        db
          .update(SessionTable)
          .set({ permission })
          .where(eq(SessionTable.id, Session.ID.make("ses_test")))
          .run()
          .pipe(Effect.orDie)

      yield* setSession([{ action: "edit", resource: "/original/**", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "edit", resources: ["/original/src/index.ts"] }))).toMatchObject({
        effect: "deny",
      })

      yield* setRules([])
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })
      yield* setSession([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toMatchObject({ effect: "deny" })
      yield* setSession([{ action: "bash", resource: "*", effect: "ask" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toMatchObject({ effect: "allow" })
    }),
  )

  it.effect("uses saved bash approvals while preserving configured deny precedence", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      yield* saved.add({ projectID: Project.ID.global, action: "bash", resources: ["pwd"] })

      const service = yield* Permission.Service
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "allow",
      })
      expect(yield* service.list()).toEqual([])

      yield* setRules([{ action: "bash", resource: "*", effect: "deny" }])
      expect(yield* service.ask(assertion({ action: "bash", resources: ["pwd"] }))).toEqual({
        id: Permission.ID.create("per_test"),
        effect: "deny",
      })
    }),
  )

  it.effect("resolves an asked permission once", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      expect(yield* service.list()).toEqual([request])
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      expect(yield* service.forSession(Session.ID.make("ses_other"))).toEqual([])
      expect(yield* service.get(request.id)).toEqual(request)
      yield* service.reply({ requestID: request.id, reply: "once" })
      yield* Fiber.join(fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.get(request.id)).toBeUndefined()
    }),
  )

  it.effect("drops undefined metadata values so pending requests encode as JSON", () =>
    Effect.gen(function* () {
      yield* setup()
      // Tools copy optional model inputs straight into metadata, so omitted inputs arrive as undefined values.
      const { service, request } = yield* waitForRequest({
        action: "glob",
        resources: ["/project"],
        metadata: { root: "/project", path: undefined, hidden: undefined, limit: undefined },
      })
      expect(request.metadata).toStrictEqual({ root: "/project" })
      expect(yield* service.forSession(request.sessionID)).toEqual([request])
      // HttpApi encodes JSON success bodies through Schema.toCodecJson, which rejects undefined values in Unknown.
      const encode = Schema.encodeEffect(Schema.toCodecJson(Schema.Struct({ data: Schema.Array(Permission.Request) })))
      expect(yield* encode({ data: yield* service.forSession(request.sessionID) })).toEqual({
        data: [
          {
            id: request.id,
            sessionID: request.sessionID,
            action: "glob",
            resources: ["/project"],
            metadata: { root: "/project" },
          },
        ],
      })
    }),
  )

  it.effect("defects when an asked permission is declined", () =>
    Effect.gen(function* () {
      yield* setup()
      const { service, fiber, request } = yield* waitForRequest()
      yield* service.reply({ requestID: request.id, reply: "reject" })
      const exit = yield* Fiber.await(fiber)

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure")
        expect(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
          ),
        ).toBe(true)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* Permission.Service
      const asked = yield* Deferred.make<Permission.Request>()
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Permission.Event.Asked.type
          ? Deferred.succeed(asked, event.data as Permission.Request).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service.assert(assertion({ save: ["src/*"] })).pipe(Effect.forkScoped)
      const request = yield* Deferred.await(asked)
      yield* service.reply({ requestID: request.id, reply: "always" })
      yield* Fiber.join(fiber)

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Project.ID.global)).all(),
      ).toMatchObject([{ action: "read", resource: "src/*" }])
      const saved = yield* PermissionSaved.Service
      const id = (yield* saved.list())[0]!.id
      expect(yield* saved.list()).toMatchObject([
        { id, projectID: Project.ID.global, action: "read", resource: "src/*" },
      ])
      yield* service.assert(assertion({ id: Permission.ID.create("per_next"), resources: ["src/next.ts"] }))
      yield* saved.remove(id)
      expect(yield* saved.list()).toEqual([])
    }),
  )

  it.effect("edits saved approvals and enforces the edited rule", () =>
    Effect.gen(function* () {
      yield* setup()
      const saved = yield* PermissionSaved.Service
      const service = yield* Permission.Service
      yield* saved.add({ projectID: Project.ID.global, action: "read", resources: ["src/*", "docs/*"] })
      const src = (yield* saved.list()).find((item) => item.resource === "src/*")

      expect(yield* saved.update({ id: src!.id, resource: "src/allowed.ts" })).toMatchObject({
        id: src!.id,
        projectID: Project.ID.global,
        action: "read",
        resource: "src/allowed.ts",
      })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_allowed"), resources: ["src/allowed.ts"] })),
      ).toMatchObject({ effect: "allow" })
      expect(
        yield* service.ask(assertion({ id: Permission.ID.create("per_other"), resources: ["src/other.ts"] })),
      ).toMatchObject({ effect: "ask" })

      expect(yield* saved.update({ id: src!.id, resource: "docs/*" }).pipe(Effect.flip)).toMatchObject({
        _tag: "PermissionSaved.ConflictError",
        id: src!.id,
        resource: "docs/*",
      })
      expect(
        yield* saved.update({ id: PermissionSaved.ID.make("psv_missing"), action: "edit" }).pipe(Effect.flip),
      ).toMatchObject({ _tag: "PermissionSaved.NotFoundError" })
    }),
  )

  for (const guard of ["configured deny", "missing Session"] as const) {
    it.effect(`skips pending auto-approval after always for ${guard}`, () =>
      Effect.gen(function* () {
        yield* setup()
        yield* setup([], Session.ID.make("ses_other"))
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("reviewer"), (agent) => {
            agent.permissions = []
          }),
        )
        const selected = yield* waitForRequest({ save: ["src/*"] })
        const other = yield* waitForRequest({
          id: Permission.ID.create("per_other"),
          sessionID: Session.ID.make("ses_other"),
          agent: Agent.ID.make("reviewer"),
        })
        if (guard === "configured deny") {
          yield* agents.transform((editor) =>
            editor.update(Agent.ID.make("reviewer"), (agent) => {
              agent.permissions = [{ action: "read", resource: "*", effect: "deny" }]
            }),
          )
        }
        if (guard === "missing Session") {
          const { db } = yield* Database.Service
          yield* db.delete(SessionTable).where(eq(SessionTable.id, other.request.sessionID)).run().pipe(Effect.orDie)
        }
        yield* selected.service.reply({ requestID: selected.request.id, reply: "always" })
        yield* Fiber.join(selected.fiber)
        expect(yield* selected.service.list()).toEqual([other.request])
        expect(other.fiber.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(other.fiber)
        expect(yield* selected.service.list()).toEqual([])
      }),
    )
  }
})

describe("shell scanner permission impact", () => {
  // Fixed cases require matching outcomes; remaining differences are investigation snapshots, not contracts.
  // These service-level cases all have command resources; tool tests cover skipped checks and directories.
  // Outcome pairs are [legacy, native].
  for (const fixture of [
    {
      name: "timed command preserves wrapper approvals",
      shell: "bash",
      command: "time -p git status",
      approved: ["time *"],
      exact: ["time -p git status"],
      denied: "time -p git status",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "coprocess command preserves wrapper approvals",
      shell: "bash",
      command: "coproc git status",
      approved: ["coproc *"],
      exact: ["coproc git status"],
      denied: "coproc git status",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "declarations and unset",
      shell: "bash",
      command: "export X=value; unset X; git status",
      approved: ["git status *"],
      exact: ["git status"],
      denied: "export *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["allow", "allow"],
    },
    {
      name: "export with an approved command substitution",
      shell: "bash",
      command: "export VERSION=$(git describe --tags); npm run build",
      approved: ["git describe *", "npm run build *"],
      exact: ["git describe --tags", "npm run build"],
      denied: "export *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["allow", "allow"],
    },
    {
      name: "export retains checks on the command substitution",
      shell: "bash",
      command: "export VERSION=$(git describe --tags); npm run build",
      approved: ["git describe *", "npm run build *"],
      exact: ["git describe --tags", "npm run build"],
      denied: "git describe *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "redirect after a conditional list",
      shell: "bash",
      command: "printf ok && git status > output",
      approved: ["printf *", "git status *"],
      exact: ["printf ok", "git status"],
      denied: "git status *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "ask"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "redirect after a pipeline",
      shell: "bash",
      command: "printf ok | cat < input > output",
      approved: ["printf *", "cat *"],
      exact: ["printf ok", "cat"],
      denied: "cat *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "ask"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "assignment redirect followed by a command",
      shell: "bash",
      command: "FOO=bar > output; printf done",
      approved: ["printf *"],
      exact: ["printf done"],
      denied: "FOO=bar > output",
      savedEffect: ["ask", "ask"],
      exactEffect: ["ask", "ask"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "assignment redirect with an approved command substitution",
      shell: "bash",
      command: "VERSION=$(git describe --tags) > build/version.txt",
      approved: ["git describe *"],
      exact: ["git describe --tags"],
      denied: "VERSION=$(git describe --tags) > build/version.txt",
      savedEffect: ["ask", "ask"],
      exactEffect: ["ask", "ask"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "substitution in a saved prefix",
      shell: "bash",
      command: "git $(printf diff) --stat",
      approved: ["git *", "printf *"],
      exact: ["git $(printf diff) --stat", "printf diff"],
      denied: "git $(printf diff) --stat",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "standalone PowerShell scriptblock caller",
      shell: "pwsh",
      command: "ForEach-Object { Write-Output value }",
      approved: ["Write-Output *"],
      exact: ["Write-Output value"],
      denied: "ForEach-Object *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["allow", "allow"],
    },
    {
      name: "tab-separated PowerShell command",
      shell: "pwsh",
      command: "git\tstatus; Write-Output done",
      approved: ["git status *", "Write-Output *"],
      exact: ["git status", "Write-Output done"],
      denied: "git\tstatus",
      savedEffect: ["allow", "ask"],
      exactEffect: ["allow", "ask"],
      deniedEffect: ["allow", "deny"],
    },
    {
      name: "PowerShell equals-joined argument",
      shell: "pwsh",
      command: "git --work-tree=src status",
      approved: ["git --work-tree *"],
      exact: ["git --work-tree"],
      denied: "git --work-tree",
      savedEffect: ["allow", "ask"],
      exactEffect: ["allow", "ask"],
      deniedEffect: ["deny", "allow"],
    },
    {
      name: "trailing redirect after list operator",
      shell: "bash",
      command: "true && cat > secret",
      approved: ["true *", "cat *"],
      exact: ["true", "cat"],
      denied: "* > secret*",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "ask"],
      deniedEffect: ["allow", "deny"],
    },
    {
      name: "commandless redirect write",
      shell: "zsh",
      command: ">> ~/.zshrc <<< 'x'",
      approved: [">> *"],
      exact: [">> ~/.zshrc <<< 'x'"],
      denied: ">> *",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
    {
      name: "PowerShell .NET method invocation",
      shell: "pwsh",
      command: '[IO.File]::Delete("C:\\victim")',
      approved: ["[IO.File]::Delete(*"],
      exact: ['[IO.File]::Delete("C:\\victim")'],
      denied: "*Delete(*",
      savedEffect: ["allow", "allow"],
      exactEffect: ["allow", "allow"],
      deniedEffect: ["deny", "deny"],
    },
  ] as const) {
    for (const scenario of [
      { name: "no approval", saved: [], rules: [], expected: ["ask", "ask"] },
      { name: "saved wildcard", saved: ["*"], rules: [], expected: ["allow", "allow"] },
      { name: "saved command approvals", saved: fixture.approved, rules: [], expected: fixture.savedEffect },
      {
        name: "exact configured approvals",
        saved: [],
        rules: fixture.exact.map((resource): Permission.Rule => ({ action: "shell", resource, effect: "allow" })),
        expected: fixture.exactEffect,
      },
      {
        name: "exact saved approvals",
        saved: fixture.exact,
        rules: [],
        expected: fixture.exactEffect,
      },
      {
        name: "configured deny despite saved wildcard",
        saved: ["*"],
        rules: [{ action: "shell", resource: fixture.denied, effect: "deny" }] satisfies Permission.Ruleset,
        expected: fixture.deniedEffect,
      },
    ] as const) {
      it.live(`${fixture.name}: ${scenario.name}`, () =>
        Effect.gen(function* () {
          yield* setup(scenario.rules)
          const saved = yield* PermissionSaved.Service
          yield* saved.add({ projectID: Project.ID.global, action: "shell", resources: scenario.saved })
          const service = yield* Permission.Service

          const parsed = yield* ShellParse.scan(fixture.command, fixture.shell, "/project")
          expect(parsed.commands.length).toBeGreaterThan(0)
          expect(parsed.directories).toEqual([])
          const result = yield* service.ask(
            assertion({
              action: "shell",
              resources: parsed.commands.map((command) => command.resource),
              save: parsed.commands.map((command) => command.save),
            }),
          )
          expect(result.effect).toBe(scenario.expected[1])
          const pending = yield* service.list()
          expect(pending).toHaveLength(result.effect === "ask" ? 1 : 0)
          if (result.effect === "ask") {
            expect(pending[0]?.resources).toEqual(parsed.commands.map((command) => command.resource))
            expect(pending[0]?.save).toEqual(parsed.commands.map((command) => command.save))
            yield* service.reply({ requestID: result.id, reply: "once" })
            expect(yield* service.list()).toEqual([])
          }
        }),
      )
    }
  }

  // Grant/repeat rows select the granting parser; repeat columns select the parser used afterwards.
  for (const fixture of [
    {
      name: "numeric npm script prefix",
      shell: "bash",
      command: "npm run 123",
      grants: [["npm run *"], ["npm run 123 *"]],
      repeat: [
        ["allow", "allow"],
        ["allow", "allow"],
      ],
      next: "npm run build",
      nextEffect: ["allow", "ask"],
    },
    {
      name: "numeric AWS option prefix",
      shell: "bash",
      command: "aws --cli-read-timeout 60 s3 ls",
      grants: [["aws --cli-read-timeout s3 *"], ["aws --cli-read-timeout 60 *"]],
      repeat: [
        ["ask", "ask"],
        ["allow", "allow"],
      ],
      next: "aws --cli-read-timeout 60 ec2 describe-instances",
      nextEffect: ["ask", "allow"],
    },
    {
      name: "substitution prefix",
      shell: "bash",
      command: "git $(printf diff) --stat",
      grants: [
        ["git --stat *", "printf *"],
        ["git $(printf diff) *", "printf *"],
      ],
      repeat: [
        ["ask", "ask"],
        ["allow", "allow"],
      ],
      next: "git --stat",
      nextEffect: ["allow", "ask"],
    },
    {
      name: "redirect prefix",
      shell: "bash",
      command: "printf ok && git status > output",
      grants: [
        ["printf *", "git status *"],
        ["printf *", "git status *"],
      ],
      repeat: [
        ["allow", "allow"],
        ["allow", "allow"],
      ],
      next: "git status --short",
      nextEffect: ["allow", "allow"],
    },
    {
      name: "assignment redirect prefix",
      shell: "bash",
      command: "FOO=bar > output; printf done",
      grants: [["printf *"], ["FOO=bar > *", "printf *"]],
      repeat: [
        ["ask", "allow"],
        ["ask", "allow"],
      ],
      next: "FOO=bar rm -rf /",
      nextEffect: ["ask", "ask"],
    },
    {
      name: "PowerShell method prefix",
      shell: "pwsh",
      command: '[IO.File]::Delete("C:\\first")',
      grants: [["[IO.File]::Delete(*"], ["[IO.File]::Delete(*"]],
      repeat: [
        ["allow", "allow"],
        ["allow", "allow"],
      ],
      next: '[IO.File]::WriteAllText("C:\\first", "x")',
      nextEffect: ["ask", "ask"],
    },
    {
      name: "PowerShell tab prefix",
      shell: "pwsh",
      command: "git\tstatus; Write-Output done",
      grants: [["Write-Output *"], ["git\tstatus *", "Write-Output *"]],
      repeat: [
        ["allow", "ask"],
        ["allow", "allow"],
      ],
      next: "git status",
      nextEffect: ["ask", "ask"],
    },
  ] as const) {
    it.live(`${fixture.name}: always allow covers repeat execution and narrows prefix scope`, () =>
      Effect.gen(function* () {
        yield* setup()
        const service = yield* Permission.Service
        const saved = yield* PermissionSaved.Service
        const parsed = yield* ShellParse.scan(fixture.command, fixture.shell, "/project")
        const first = yield* service.ask(
          assertion({
            action: "shell",
            resources: parsed.commands.map((command) => command.resource),
            save: parsed.commands.map((command) => command.save),
          }),
        )
        expect(first.effect).toBe("ask")
        expect(yield* service.list()).toHaveLength(1)
        yield* service.reply({ requestID: first.id, reply: "always" })
        expect(yield* service.list()).toEqual([])
        expect((yield* saved.list({ projectID: Project.ID.global })).map((rule) => rule.resource).sort()).toEqual(
          [...fixture.grants[1]].sort(),
        )

        for (const command of [fixture.command, fixture.next]) {
          const parsed = yield* ShellParse.scan(command, fixture.shell, "/project")
          const result = yield* service.ask(
            assertion({
              action: "shell",
              resources: parsed.commands.map((command) => command.resource),
              save: parsed.commands.map((command) => command.save),
            }),
          )
          expect(result.effect, command).toBe(command === fixture.next ? fixture.nextEffect[1] : fixture.repeat[1]?.[1])
          if (result.effect === "ask") yield* service.reply({ requestID: result.id, reply: "once" })
          expect(yield* service.list()).toEqual([])
        }
      }),
    )
  }
})
