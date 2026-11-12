import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionExecution } from "@opencode/core/session/execution"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Effect, Fiber } from "effect"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"

const document = (experimental?: ConstructorParameters<typeof ConfigExperimental.Info>[0]) =>
  new Document({
    type: "document",
    info: new Info(experimental === undefined ? {} : { experimental: new ConfigExperimental.Info(experimental) }),
  })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      Session.node,
      SessionExecution.node,
      LocationServiceMap.node,
      SubagentJob.node,
    ]),
    [Global.node.replace(tempGlobalLayer), offlineModels],
  ),
)

describe("SubagentJob.limits", () => {
  test("stays unlimited without a setting and reads each key from its own document", () => {
    expect(SubagentJob.limits([])).toEqual({ limit: -1, mode: "fail" })
    expect(SubagentJob.limits([document(), document({ subagent_depth: 2 })])).toEqual({ limit: -1, mode: "fail" })
    expect(SubagentJob.limits([document({ subagent_concurrency: 3 }), document({ subagent_over_limit: "wait" })])).toEqual(
      { limit: 3, mode: "wait" },
    )
  })

  test("a later partial experimental block does not shadow an earlier limit", () => {
    // The global layer sets the cap; the project block only sets the depth, as Config.latest would drop the cap.
    expect(SubagentJob.limits([document({ subagent_concurrency: 4 }), document({ subagent_depth: 2 })]).limit).toBe(4)
    expect(
      SubagentJob.limits([document({ subagent_concurrency: 4 }), document({ subagent_concurrency: 1 })]).limit,
    ).toBe(1)
  })
})

describe("SubagentJob concurrency slots", () => {
  it.effect("leaves unlimited counts unbudgeted and caps one parent at a time", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_unlimited")
      expect(
        yield* subagents.acquire({
          parentSessionID: parent,
          childSessionID: SessionSchema.ID.make("ses_unlimited_a"),
          limit: -1,
          mode: "fail",
        }),
      ).toBe(true)
      expect(
        yield* subagents.acquire({
          parentSessionID: parent,
          childSessionID: SessionSchema.ID.make("ses_unlimited_b"),
          limit: -1,
          mode: "fail",
        }),
      ).toBe(true)

      const capped = SessionSchema.ID.make("ses_capped")
      const first = SessionSchema.ID.make("ses_capped_first")
      const second = SessionSchema.ID.make("ses_capped_second")
      expect(yield* subagents.acquire({ parentSessionID: capped, childSessionID: first, limit: 1, mode: "fail" })).toBe(
        true,
      )
      // The same child keeps its existing slot instead of budgeting a second one.
      expect(yield* subagents.acquire({ parentSessionID: capped, childSessionID: first, limit: 1, mode: "fail" })).toBe(
        true,
      )
      expect(
        yield* subagents.acquire({ parentSessionID: capped, childSessionID: second, limit: 1, mode: "fail" }),
      ).toBe(false)
      // A different parent gets its own allowance.
      expect(
        yield* subagents.acquire({
          parentSessionID: SessionSchema.ID.make("ses_other_parent"),
          childSessionID: second,
          limit: 1,
          mode: "fail",
        }),
      ).toBe(true)
      yield* subagents.release(capped, first)
      expect(yield* subagents.acquire({ parentSessionID: capped, childSessionID: second, limit: 1, mode: "fail" })).toBe(
        true,
      )
    }),
  )

  it.effect("refuses every call at a cap of zero, in both modes", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_zero")
      const child = SessionSchema.ID.make("ses_zero_child")
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: child, limit: 0, mode: "fail" })).toBe(
        false,
      )
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: child, limit: 0, mode: "wait" })).toBe(
        false,
      )
    }),
  )

  it.effect("releases a slot twice without losing the remaining ones", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_release")
      const first = SessionSchema.ID.make("ses_release_first")
      const second = SessionSchema.ID.make("ses_release_second")
      const third = SessionSchema.ID.make("ses_release_third")
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: first, limit: 2, mode: "fail" })).toBe(
        true,
      )
      expect(
        yield* subagents.acquire({ parentSessionID: parent, childSessionID: second, limit: 2, mode: "fail" }),
      ).toBe(true)
      expect(
        yield* subagents.acquire({ parentSessionID: parent, childSessionID: third, limit: 2, mode: "fail" }),
      ).toBe(false)
      yield* subagents.release(parent, first)
      yield* subagents.release(parent, first)
      expect(
        yield* subagents.acquire({ parentSessionID: parent, childSessionID: third, limit: 2, mode: "fail" }),
      ).toBe(true)
      // Releasing an unknown child keeps the remaining budget.
      yield* subagents.release(parent, SessionSchema.ID.make("ses_release_unknown"))
      expect(
        yield* subagents.acquire({
          parentSessionID: parent,
          childSessionID: SessionSchema.ID.make("ses_release_fourth"),
          limit: 2,
          mode: "fail",
        }),
      ).toBe(false)
    }),
  )

  it.effect("queues a wait call until the held slot frees", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_queued")
      const held = SessionSchema.ID.make("ses_queued_held")
      const queued = SessionSchema.ID.make("ses_queued_next")
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: held, limit: 1, mode: "wait" })).toBe(
        true,
      )
      const fiber = yield* subagents
        .acquire({ parentSessionID: parent, childSessionID: queued, limit: 1, mode: "wait" })
        .pipe(Effect.forkScoped({ startImmediately: true }))
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* subagents.release(parent, held)
      expect(yield* Fiber.join(fiber)).toBe(true)
    }),
  )

  it.effect("counts recovered children against the cap and frees their slot on release", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_recovered")
      const recovered = SessionSchema.ID.make("ses_recovered_child")
      const next = SessionSchema.ID.make("ses_recovered_next")
      yield* subagents.recover(parent, recovered)
      // The recovered child holds a slot even though it never called acquire.
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: next, limit: 1, mode: "fail" })).toBe(
        false,
      )
      // A follow-up on the recovered child keeps its existing slot.
      expect(
        yield* subagents.acquire({ parentSessionID: parent, childSessionID: recovered, limit: 1, mode: "fail" }),
      ).toBe(true)
      yield* subagents.release(parent, recovered)
      expect(yield* subagents.acquire({ parentSessionID: parent, childSessionID: next, limit: 1, mode: "fail" })).toBe(
        true,
      )
    }),
  )

  it.effect("stops waiting when the call is cancelled", () =>
    Effect.gen(function* () {
      const subagents = yield* SubagentJob.Service
      const parent = SessionSchema.ID.make("ses_cancel")
      expect(
        yield* subagents.acquire({
          parentSessionID: parent,
          childSessionID: SessionSchema.ID.make("ses_cancel_held"),
          limit: 1,
          mode: "wait",
        }),
      ).toBe(true)
      expect(
        yield* subagents.acquire({
          parentSessionID: parent,
          childSessionID: SessionSchema.ID.make("ses_cancel_queued"),
          limit: 1,
          mode: "wait",
          cancel: Effect.sync(() => {}),
        }),
      ).toBe(false)
    }),
  )
})
