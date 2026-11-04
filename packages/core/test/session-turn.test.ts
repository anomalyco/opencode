import { expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { EventTable } from "@opencode/core/event/sql"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionEvent } from "@opencode/schema/session-event"
import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionTurnStore } from "@opencode/core/session/turn"
import { SessionTable } from "@opencode/core/session/sql"
import { testEffect } from "./lib/effect"

// Production default: payload history is not retained. Results must still be durable projections.
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node])),
)
const sessionID = Session.ID.make("ses_turn_test")
const tokens = { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 4 } }

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", version: "test" })
    .run()
  return {
    db,
    bus,
    inbox,
    admit: (id = SessionMessage.ID.create()) =>
      inbox.admit({ id, sessionID, item: { type: "user", delivery: "queue", payload: { text: "Work" } } }),
    deliver: (id: SessionMessage.ID) => bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id }),
    get: (inputID: SessionMessage.ID) => SessionTurnStore.get(db, { sessionID, inputID }),
    step: (assistantMessageID: SessionMessage.ID) =>
      bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID,
        agent: Agent.ID.make("general"),
        model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
        started: 0,
      }),
  }
})

it.effect("retains exact input results without event payloads and ignores later turns", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const first = yield* s.admit()
    const second = yield* s.admit()
    expect(yield* s.get(first.id)).toEqual({ sessionID, inputID: first.id, status: "pending" })
    yield* s.deliver(first.id)
    const assistantMessageID = SessionMessage.ID.create()
    yield* s.step(assistantMessageID)
    yield* s.bus.publish(SessionEvent.Step.Ended, {
      sessionID,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.make(1),
      tokens,
    })
    yield* s.bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "title", cost: Money.USD.make(100), tokens })
    yield* s.bus.publish(SessionEvent.TurnSettled, { sessionID })
    const result = yield* s.get(first.id)
    expect(result).toEqual({
      sessionID,
      inputID: first.id,
      turnID: first.id,
      inputIDs: [first.id],
      status: "settled",
      cost: Money.USD.make(1),
      tokens,
      assistantMessageID,
    })
    yield* s.deliver(second.id)
    yield* s.bus.publish(SessionEvent.Execution.Failed, {
      sessionID,
      error: { type: "unknown", message: "Later failure" },
    })
    expect(yield* s.get(first.id)).toEqual(result)
    expect(yield* s.get(second.id)).toMatchObject({
      status: "failed",
      error: { type: "unknown", message: "Later failure" },
    })
    expect(yield* s.db.select().from(EventTable).all()).toEqual([])
    expect(yield* SessionTurnStore.get(s.db, { sessionID: Session.ID.create(), inputID: first.id })).toBeUndefined()
    expect(yield* s.get(SessionMessage.ID.create())).toBeUndefined()
  }),
)

it.effect("shares full usage with a steer, preserves it across shutdown and includes failed attempts", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const first = yield* s.admit()
    yield* s.deliver(first.id)
    const assistantMessageID = SessionMessage.ID.create()
    yield* s.step(assistantMessageID)
    yield* s.bus.publish(SessionEvent.Step.Failed, {
      sessionID,
      assistantMessageID,
      error: { type: "unknown", message: "Retry" },
      cost: Money.USD.make(2),
      tokens,
    })
    const steer = yield* s.admit()
    yield* s.deliver(steer.id)
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
    expect(yield* s.get(steer.id)).toMatchObject({ status: "running", turnID: first.id, cost: 2 })
    yield* s.bus.publish(SessionEvent.Execution.Started, { sessionID })
    yield* s.bus.publish(SessionEvent.UsageRecorded, {
      sessionID,
      source: "compaction",
      cost: Money.USD.make(3),
      tokens,
    })
    yield* s.bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "user" })
    const result = yield* s.get(first.id)
    if (!result) throw new Error("Missing input turn")
    expect(result).toMatchObject({
      status: "interrupted",
      reason: "user",
      cost: 2,
      inputIDs: [first.id, steer.id],
      tokens: { input: 10, output: 5 },
    })
    expect(yield* s.get(steer.id)).toEqual({ ...result, inputID: steer.id })
  }),
)

it.effect("cancels an unpromoted input without attaching it to the active turn", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const active = yield* s.admit()
    yield* s.deliver(active.id)
    const pending = yield* s.admit()
    yield* s.bus.publish(SessionEvent.InboxCancelled, { sessionID, inboxID: pending.id })
    expect(yield* s.get(pending.id)).toMatchObject({
      status: "interrupted",
      reason: "cancelled",
      cost: 0,
      turnID: pending.id,
    })
    expect(yield* s.get(active.id)).toMatchObject({ status: "running", inputIDs: [active.id] })
    expect(yield* s.admit(pending.id).pipe(Effect.flip)).toMatchObject({ _tag: "SessionInbox.LifecycleConflict" })
  }),
)

it.effect("retries admission without delivering or charging a completed input again", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const input = yield* s.admit()
    expect((yield* s.admit(input.id)).id).toBe(input.id)
    yield* s.deliver(input.id)
    yield* s.bus.publish(SessionEvent.TurnSettled, { sessionID })
    expect((yield* s.admit(input.id)).id).toBe(input.id)
    expect(yield* SessionInbox.list(s.db, sessionID)).toEqual([])
    expect(yield* s.get(input.id)).toMatchObject({ status: "settled", inputIDs: [input.id] })
  }),
)

it.effect("retains completed results on history reversion and cancels removed queued work", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const input = yield* s.admit()
    yield* s.deliver(input.id)
    yield* s.bus.publish(SessionEvent.TurnSettled, { sessionID })
    const pending = yield* s.admit()
    const completed = yield* s.get(input.id)
    yield* s.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID, to: input.id })
    expect(yield* s.get(input.id)).toEqual(completed)
    expect(yield* s.get(pending.id)).toMatchObject({ status: "interrupted", reason: "cancelled" })
    expect(yield* s.admit(input.id).pipe(Effect.flip)).toMatchObject({ _tag: "SessionInbox.LifecycleConflict" })
    yield* s.bus.publish(SessionEvent.Deleted, { sessionID })
    expect(yield* s.get(input.id)).toBeUndefined()
    expect(yield* s.get(pending.id)).toBeUndefined()
  }),
)
