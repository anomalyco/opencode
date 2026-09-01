import { describe, expect } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Permission } from "@opencode-ai/core/permission"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Session } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/promise/plugin"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Cause, Deferred, Effect, Exit, Fiber, Queue } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Plugin.node, Database.node, Bus.node, Location.node]), {
    replacements: [
      Location.node.replace(tempLocationLayer),
      Config.node.replace(Config.testLayer()),
      Mcp.node.replace(emptyMcpLayer),
    ],
  }),
)

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const location = yield* Location.Service
  const plugins = yield* Plugin.Service
  const bus = yield* Bus.Service
  const asked = yield* Queue.unbounded<void>()
  const unsubscribe = yield* bus.listen((event) =>
    event.type === Permission.Event.Asked.type ? Queue.offer(asked, undefined).pipe(Effect.asVoid) : Effect.void,
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  const ready = yield* Deferred.make<Context>()
  yield* plugins.activate([{ id: "permission-test", revision: "1", effect: (ctx) => Deferred.succeed(ready, ctx) }])
  const ctx = yield* Deferred.await(ready)
  yield* ctx.agent.transform((draft) =>
    draft.update("permission-test", (agent) => {
      agent.permissions = [
        { action: "deploy", resource: "*", effect: "ask" },
        { action: "deploy", resource: "allowed", effect: "allow" },
        { action: "deploy", resource: "blocked", effect: "deny" },
      ]
    }),
  )
  const sessionID = Session.ID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({ id: location.project.id, worktree: location.directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: location.project.id,
      slug: "permission-test",
      directory: location.directory,
      title: "Permission test",
      version: "test",
      agent: "missing",
    })
    .run()
  const input = {
    id: Permission.ID.create(),
    sessionID,
    agent: Agent.ID.make("permission-test"),
    action: "deploy",
    resources: ["staging"],
    save: ["staging"],
    metadata: { environment: "staging" },
    source: { type: "tool", messageID: "msg_test", id: "call_test" },
  } satisfies Permission.AssertInput
  return { ctx, input, asked }
})

describe("plugin permission.assert", () => {
  it.live("preserves Effect decisions, rejection defects, feedback, and cancellation cleanup", () =>
    Effect.gen(function* () {
      const { ctx, input, asked } = yield* setup
      expect(yield* ctx.permission.assert({ ...input, resources: ["allowed"] })).toBeUndefined()
      expect(yield* ctx.permission.assert({ ...input, resources: ["blocked"] }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.BlockedError,
      )
      expect(yield* ctx.permission.list(input)).toEqual([])

      yield* Effect.forEach(["once", "reject", "feedback", "cancel"] as const, (reply) =>
        Effect.gen(function* () {
          const fiber = yield* ctx.permission.assert(input).pipe(Effect.forkScoped)
          yield* Queue.take(asked)
          expect(fiber.pollUnsafe()).toBeUndefined()
          expect(yield* ctx.permission.get({ sessionID: input.sessionID, requestID: input.id })).toMatchObject({
            id: input.id,
            sessionID: input.sessionID,
            action: input.action,
            resources: input.resources,
            save: input.save,
            metadata: input.metadata,
            source: input.source,
          })
          if (reply === "cancel") yield* Fiber.interrupt(fiber)
          if (reply !== "cancel")
            yield* ctx.permission.reply({
              sessionID: input.sessionID,
              requestID: input.id,
              reply: reply === "feedback" ? "reject" : reply,
              message: reply === "feedback" ? "Use the test environment" : undefined,
            })
          const exit = yield* Fiber.await(fiber)
          if (reply === "once") expect(exit).toEqual(Exit.succeed(undefined))
          if (reply !== "once") {
            expect(Exit.isFailure(exit)).toBe(true)
            if (Exit.isFailure(exit)) {
              if (reply === "cancel") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
              if (reply === "reject")
                expect(exit.cause.reasons).toContainEqual(
                  expect.objectContaining({ _tag: "Die", defect: expect.any(Permission.DeclinedError) }),
                )
              if (reply === "feedback")
                expect(exit.cause.reasons).toContainEqual(
                  expect.objectContaining({
                    _tag: "Fail",
                    error: new Permission.CorrectedError({ feedback: "Use the test environment" }),
                  }),
                )
            }
          }
          expect(yield* ctx.permission.list(input)).toEqual([])
        }),
      )
    }),
  )

  it.live("decodes Promise inputs and preserves void results and permission errors through the real host", () =>
    Effect.gen(function* () {
      const { ctx, input, asked } = yield* setup
      yield* PluginPromise.fromPromise(
        define({
          id: "promise-permission-test",
          setup: async (ctx) => {
            await expect(
              Reflect.apply(ctx.permission.assert, undefined, [{ ...input, resources: [42] }]),
            ).rejects.toBeDefined()
            expect(await ctx.permission.list(input)).toEqual([])
            expect(await ctx.permission.assert({ ...input, id: null, resources: ["allowed"] })).toBeUndefined()
            await expect(ctx.permission.assert({ ...input, resources: ["blocked"] })).rejects.toBeInstanceOf(
              Permission.BlockedError,
            )

            for (const reply of ["once", "reject", "feedback"] as const) {
              const pending = ctx.permission.assert(input)
              const settled = pending.then(
                (value) => ({ value }),
                (error: unknown) => ({ error }),
              )
              await Effect.runPromise(Queue.take(asked))
              expect(await ctx.permission.get({ sessionID: input.sessionID, requestID: input.id })).toMatchObject({
                metadata: input.metadata,
                source: input.source,
                save: input.save,
              })
              await ctx.permission.reply({
                sessionID: input.sessionID,
                requestID: input.id,
                reply: reply === "feedback" ? "reject" : reply,
                ...(reply === "feedback" ? { message: "Use the test environment" } : {}),
              })
              if (reply === "once") expect(await settled).toEqual({ value: undefined })
              if (reply === "reject") expect(await settled).toEqual({ error: expect.any(Permission.DeclinedError) })
              if (reply === "feedback")
                expect(await settled).toEqual({
                  error: new Permission.CorrectedError({ feedback: "Use the test environment" }),
                })
              expect(await ctx.permission.list(input)).toEqual([])
            }
          },
        }),
      ).effect(ctx)
    }),
  )
})
