import { describe, expect } from "bun:test"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { EventTable } from "@opencode/core/event/sql"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import {
  SessionMessageTable,
  SessionPendingStepTable,
  SessionQuestionTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { Form } from "@opencode/core/form"
import { Flag } from "@opencode/core/flag"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, Form.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const sessionID = Session.ID.make("ses_step_ownership")
const otherSessionID = Session.ID.make("ses_other_ownership")
const assistantMessageID = SessionMessage.ID.make("msg_step_owner")
const otherMessageID = SessionMessage.ID.make("msg_other_owner")
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const prepared = {
  adapter: "question@1" as const,
  input: {
    questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "Continue" }] }],
  },
}

const parkedData = (
  session: Session.ID,
  assistant: SessionMessage.ID,
  generation: number,
): SessionEvent.Step.ParkedPayload => ({
  sessionID: session,
  assistantMessageID: assistant,
  generation,
  step: 1,
  finish: "tool-calls" as const,
  cost: Money.USD.make(0),
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  questions: [{ callID: "call_owner", questionID: Form.ID.make("frm_owner"), prepared }],
})

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
  const bus = yield* Bus.Service
  yield* Effect.forEach([sessionID, otherSessionID], (id) =>
    bus.publish(SessionEvent.Created, {
      sessionID: id,
      projectID: Project.ID.global,
      location: { directory: AbsolutePath.make("/project") },
      slug: "ownership",
      version: "test",
    }),
  )
  yield* db.update(SessionTable).set({ time_suspended: 1 })
  const event = yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.defaultID,
    model,
    started: 100,
  })
  return { db, generation: event.durable.seq }
})

const start = (sessionID: Session.ID, assistantMessageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.defaultID,
      model,
      started: 200,
    })
  })

describe("Question resolution admission", () => {
  const questionID = Form.ID.make("frm_owner")

  const setup = (usage?: Pick<SessionEvent.Step.ParkedPayload, "cost" | "tokens">, sibling = false) =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const bus = yield* Bus.Service
      yield* Effect.forEach(sibling ? ["call_owner", "sibling"] : ["call_owner"], (id) =>
        Effect.gen(function* () {
          yield* bus.publish(SessionEvent.Tool.Input.Started, {
            sessionID,
            assistantMessageID,
            id,
            name: "question",
          })
          yield* bus.publish(SessionEvent.Tool.Called, {
            sessionID,
            assistantMessageID,
            id,
            input: prepared.input,
            executed: false,
          })
        }),
      )
      yield* bus.publish(SessionEvent.Step.Streamed, {
        sessionID,
        assistantMessageID,
      })
      yield* bus.publish(SessionEvent.Step.Parked, {
        ...parkedData(sessionID, assistantMessageID, fixture.generation),
        ...usage,
        questions: [
          { callID: "call_owner", questionID, prepared },
          ...(sibling ? [{ callID: "sibling", questionID: Form.ID.make("frm_sibling"), prepared }] : []),
        ],
      })
      return { ...fixture, bus }
    })

  const originalTool = Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const row = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, assistantMessageID)).get()
    if (!row) return undefined
    const [full = row] = yield* SessionHistory.withParts(db, [row])
    const message = SessionHistory.decodeMessageRowSync(full)
    if (message.type !== "assistant") return undefined
    return message.content.find(
      (part): part is Extract<SessionMessage.AssistantContent, { readonly type: "tool" }> =>
        part.type === "tool" && part.id === "call_owner",
    )
  })

  const resolve = (generation: number, terminal: SessionEvent.QuestionResolution.Resolved["data"]["terminal"]) => ({
    sessionID,
    assistantMessageID,
    generation,
    questionID,
    callID: "call_owner",
    terminal,
  })

  for (const mode of ["inline", "part_rows"] as const) {
    for (const message of [undefined, "Continue with defaults"] as const) {
      it.effect(
        `cancels sibling Questions through fresh Forms (${mode}, ${message === undefined ? "dismiss" : "feedback"})`,
        () =>
          Effect.gen(function* () {
            const fixture = yield* setup(
              {
                cost: Money.USD.make(1.25),
                tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 3, write: 1 } },
              },
              true,
            )
            const events: string[] = []
            const unsubscribe = yield* fixture.bus.listen((event) =>
              Effect.sync(() => {
                events.push(event.type)
              }),
            )
            yield* Effect.addFinalizer(() => unsubscribe)
            yield* Effect.gen(function* () {
              const forms = yield* Form.Service
              expect(yield* forms.list({ sessionID })).toHaveLength(2)
              expect(yield* forms.get(questionID)).toMatchObject({
                id: questionID,
                metadata: {
                  kind: "question",
                  tool: { messageID: assistantMessageID, id: "call_owner" },
                },
              })
              yield* forms.cancel(questionID, { message })
              expect(yield* forms.state(Form.ID.make("frm_sibling"))).toEqual({
                status: "cancelled",
                ...(message === undefined ? {} : { message }),
              })
              expect(yield* forms.list({ sessionID })).toEqual([])
              expect(yield* forms.cancel(questionID).pipe(Effect.flip)).toBeInstanceOf(Form.AlreadySettledError)
            }).pipe(Effect.provide(Form.layer))
            expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
            const row = yield* fixture.db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, assistantMessageID))
              .get()
            if (!row) throw new Error("Assistant missing")
            const [full = row] = yield* SessionHistory.withParts(fixture.db, [row])
            const assistant = SessionHistory.decodeMessageRowSync(full)
            expect(assistant).toMatchObject({
              cost: 1.25,
              finish: "tool-calls",
              content: [
                {
                  id: "call_owner",
                  state: { status: "error", error: { message: message ?? "The user dismissed this question" } },
                },
                { id: "sibling", state: { status: "error" } },
              ],
            })
            expect(assistant.time).toHaveProperty("completed")
            expect(
              yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
            ).toMatchObject({
              cost: 1.25,
              tokens_input: 11,
              tokens_output: 7,
              resume_step: message === undefined ? null : 2,
            })
            expect(events.filter((type) => type === Form.Event.Cancelled.type)).toHaveLength(2)
          }).pipe(
            Effect.provide(
              Flag.testLayer([
                new Document({
                  type: "document",
                  info: new Info({
                    experimental: new ConfigExperimental.Info({ part_rows: mode === "part_rows" }),
                  }),
                }),
              ]),
            ),
          ),
      )
    }
  }

  for (const outcome of ["answered", "legacy", "feedback", "dismissed"] as const) {
    it.effect(`replays ${outcome} parked settlement into a second database without execution hooks`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup({
          cost: Money.USD.make(1.25),
          tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 3, write: 1 } },
        })
        // This hook runs only on the source. The target replays the durable log alone.
        yield* fixture.bus.publish(
          SessionEvent.Execution.Started,
          { sessionID },
          {
            commit: () =>
              fixture.db
                .update(SessionTable)
                .set({ time_suspended: 100 })
                .where(eq(SessionTable.id, sessionID))
                .run()
                .pipe(Effect.orDie),
          },
        )
        yield* fixture.bus.publish(
          SessionEvent.QuestionResolution.Resolved,
          resolve(
            fixture.generation,
            outcome === "answered" || outcome === "legacy"
              ? { status: "answered", answer: { q0: "Yes" } }
              : { status: "cancelled", ...(outcome === "feedback" ? { message: "Continue with defaults" } : {}) },
          ),
        )
        if (outcome === "answered" || outcome === "legacy")
          yield* fixture.bus.publish(SessionEvent.Step.Settled, {
            sessionID,
            assistantMessageID,
            generation: fixture.generation,
          })
        const history = yield* fixture.db
          .select({
            id: SessionMessageTable.id,
            data: SessionMessageTable.data,
            generation: SessionMessageTable.step_started_seq,
            seq: SessionMessageTable.seq,
          })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, sessionID))
        const questions = yield* fixture.db.select().from(SessionQuestionTable)
        const usage = yield* fixture.db
          .select({
            cost: SessionTable.cost,
            step: SessionTable.resume_step,
            input: SessionTable.tokens_input,
            output: SessionTable.tokens_output,
            reasoning: SessionTable.tokens_reasoning,
            read: SessionTable.tokens_cache_read,
            write: SessionTable.tokens_cache_write,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
        expect(usage).toMatchObject({ cost: 1.25, input: 11, output: 7, reasoning: 2, read: 3, write: 1 })
        const recorded = (yield* fixture.db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(asc(EventTable.seq))).map((event) => ({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data:
            outcome === "legacy" && event.type === "session.step.parked.1"
              ? Object.fromEntries(Object.entries(event.data).filter(([key]) => key !== "step"))
              : event.data,
        }))
        const target = AppNodeBuilder.build(
          LayerNode.group([Database.node, Bus.node, SessionProjector.node, Form.node]),
          [Database.node.replace(Database.configured()), Bus.node.replace(Bus.configured({ persist: true }))],
        )
        yield* Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const bus = yield* Bus.Service
          expect(db).not.toBe(fixture.db)
          yield* db
            .insert(ProjectTable)
            .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
          yield* Effect.forEach(recorded, (event) => bus.replay(event), { discard: true })
          expect(
            yield* db
              .select({
                id: SessionMessageTable.id,
                data: SessionMessageTable.data,
                generation: SessionMessageTable.step_started_seq,
                seq: SessionMessageTable.seq,
              })
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, sessionID)),
          ).toEqual(history)
          expect(yield* db.select().from(SessionQuestionTable)).toEqual(questions)
          expect(yield* db.select().from(SessionPendingStepTable)).toEqual([])
          expect(
            yield* db
              .select({
                cost: SessionTable.cost,
                step: SessionTable.resume_step,
                input: SessionTable.tokens_input,
                output: SessionTable.tokens_output,
                reasoning: SessionTable.tokens_reasoning,
                read: SessionTable.tokens_cache_read,
                write: SessionTable.tokens_cache_write,
              })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get(),
          ).toEqual(usage)
          expect(
            yield* db
              .select({ claim: SessionTable.time_suspended })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get(),
          ).toEqual({ claim: null })
          // Replaying the same log must neither account nor finalize the tools again.
          yield* Effect.forEach(recorded, (event) => bus.replay(event), { discard: true })
          expect(
            yield* db
              .select({
                id: SessionMessageTable.id,
                data: SessionMessageTable.data,
                generation: SessionMessageTable.step_started_seq,
                seq: SessionMessageTable.seq,
              })
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, sessionID)),
          ).toEqual(history)
          expect(
            yield* db
              .select({
                cost: SessionTable.cost,
                step: SessionTable.resume_step,
                input: SessionTable.tokens_input,
                output: SessionTable.tokens_output,
                reasoning: SessionTable.tokens_reasoning,
                read: SessionTable.tokens_cache_read,
                write: SessionTable.tokens_cache_write,
              })
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get(),
          ).toEqual(usage)
        }).pipe(Effect.provide(Layer.fresh(target)))
      }),
    )
  }

  for (const step of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    it.effect(`rejects new parking with logical step ${String(step)}`, () =>
      Effect.gen(function* () {
        const fixture = yield* seed
        const bus = yield* Bus.Service
        yield* bus.publish(SessionEvent.Tool.Input.Started, {
          sessionID,
          assistantMessageID,
          id: "call_owner",
          name: "question",
        })
        yield* bus.publish(SessionEvent.Tool.Called, {
          sessionID,
          assistantMessageID,
          id: "call_owner",
          input: {},
          executed: false,
        })
        yield* bus.publish(SessionEvent.Step.Streamed, { sessionID, assistantMessageID })
        const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
        const payload = { ...parkedData(sessionID, assistantMessageID, fixture.generation), step }
        expect(yield* bus.publish(SessionEvent.Step.Parked, payload).pipe(Effect.exit)).toMatchObject({
          _tag: "Failure",
        })
        expect(yield* bus.publishAll([[SessionEvent.Step.Parked, payload]]).pipe(Effect.exit)).toMatchObject({
          _tag: "Failure",
        })
        expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
        expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
        expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([])
      }),
    )
  }

  it.effect("rejects a stale settlement generation without consuming the parked Step", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)

      const result = yield* fixture.bus.publish(SessionEvent.Step.Settled, {
        sessionID,
        assistantMessageID,
        generation: fixture.generation + 1,
      }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* fixture.db.select().from(SessionPendingStepTable).get())
        .toMatchObject({
          session_id: sessionID,
          assistant_message_id: assistantMessageID,
          generation: fixture.generation,
        })
    }),
  )

  it.effect("accounts nonzero parked usage once and rejects duplicate settlement", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const bus = yield* Bus.Service
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        id: "call_owner",
        name: "question",
      })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "call_owner",
        input: prepared.input,
        executed: false,
      })
      yield* bus.publish(SessionEvent.Step.Streamed, { sessionID, assistantMessageID })
      yield* bus.publish(SessionEvent.Step.Parked, {
        ...parkedData(sessionID, assistantMessageID, fixture.generation),
        cost: Money.USD.make(1.25),
        tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 3, write: 1 } },
      })
      yield* bus.publish(
        SessionEvent.QuestionResolution.Resolved,
        resolve(fixture.generation, { status: "answered", answer: { q0: "Yes" } }),
      )

      const settled = { sessionID, assistantMessageID, generation: fixture.generation }
      yield* bus.publish(SessionEvent.Step.Settled, settled)

      const first = yield* fixture.db.select().from(SessionTable)
        .where(eq(SessionTable.id, sessionID)).get()
      expect(first?.cost).toBe(1.25)
      expect(first).toMatchObject({
        cost: 1.25,
        tokens_input: 11,
        tokens_output: 7,
        tokens_reasoning: 2,
        tokens_cache_read: 3,
        tokens_cache_write: 1,
      })

      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      expect(yield* bus.publish(SessionEvent.Step.Settled, settled).pipe(Effect.exit))
        .toMatchObject({ _tag: "Failure" })
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* fixture.db.select().from(SessionTable)
        .where(eq(SessionTable.id, sessionID)).get()).toEqual(first)
    }),
  )

  it.effect("rejects settlement while the original Question is pending", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)

      const result = yield* fixture.bus.publish(SessionEvent.Step.Settled, {
        sessionID,
        assistantMessageID,
        generation: fixture.generation,
      }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* fixture.db.select().from(SessionPendingStepTable).all()).toHaveLength(1)
      expect(yield* fixture.db.select().from(SessionQuestionTable).get())
        .toMatchObject({ status: "pending" })

      const row = yield* fixture.db.select().from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID)).get()
      expect(row).toBeDefined()
      if (!row) return
      const [full = row] = yield* SessionHistory.withParts(fixture.db, [row])
      const assistant = SessionHistory.decodeMessageRowSync(full)
      expect(assistant.type).toBe("assistant")
      if (assistant.type === "assistant") expect(assistant.time.completed).toBeUndefined()
    }),
  )

  it.effect("rolls back parked consumption when assistant finalization fails", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.bus.publish(
        SessionEvent.QuestionResolution.Resolved,
        resolve(fixture.generation, { status: "answered", answer: { q0: "Yes" } }),
      )
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      const before = yield* fixture.db.select().from(SessionTable)
        .where(eq(SessionTable.id, sessionID)).get()

      yield* fixture.db.run(sql`
        CREATE TRIGGER reject_step_settlement
        BEFORE UPDATE ON session_message
        WHEN NEW.id = 'msg_step_owner'
        BEGIN
          SELECT RAISE(ABORT, 'injected step settlement failure');
        END
      `)

      const result = yield* fixture.bus.publish(SessionEvent.Step.Settled, {
        sessionID,
        assistantMessageID,
        generation: fixture.generation,
      }).pipe(Effect.exit)

      expect(result._tag).toBe("Failure")
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* fixture.db.select().from(SessionPendingStepTable).all()).toHaveLength(1)
      expect(yield* fixture.db.select().from(SessionQuestionTable).get())
        .toMatchObject({ status: "answered" })
      expect(yield* fixture.db.select().from(SessionTable)
        .where(eq(SessionTable.id, sessionID)).get()).toEqual(before)

      const row = yield* fixture.db.select().from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID)).get()
      expect(row).toBeDefined()
      if (!row) return
      const [full = row] = yield* SessionHistory.withParts(fixture.db, [row])
      const assistant = SessionHistory.decodeMessageRowSync(full)
      expect(assistant.type).toBe("assistant")
      if (assistant.type === "assistant") expect(assistant.time.completed).toBeUndefined()
    }),
  )

  it.effect("settles the original parked Step after its Question is answered", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.bus.publish(
        SessionEvent.QuestionResolution.Resolved,
        resolve(fixture.generation, { status: "answered", answer: { q0: "Yes" } }),
      )

      const settled = {
        sessionID,
        assistantMessageID,
        generation: fixture.generation,
      }
      yield* fixture.bus.publish(SessionEvent.Step.Settled, settled)

      const row = yield* fixture.db.select().from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID)).get()
      expect(row).toBeDefined()
      if (!row) return

      const [full = row] = yield* SessionHistory.withParts(fixture.db, [row])
      const assistant = SessionHistory.decodeMessageRowSync(full)
      expect(assistant.type).toBe("assistant")
      if (assistant.type !== "assistant") return

      expect(assistant.time.completed).toBeDefined()
      expect(assistant.finish).toBe("tool-calls")
      expect(assistant.cost).toBe(Money.USD.make(0))
      expect(assistant.content.find((part) => part.type === "tool" && part.id === "call_owner"))
        .toMatchObject({ state: { status: "completed" } })

      expect(yield* fixture.db.select().from(SessionPendingStepTable).all()).toHaveLength(0)
      expect(yield* fixture.db.select().from(SessionQuestionTable).get())
        .toMatchObject({ status: "answered" })

      const session = yield* fixture.db.select().from(SessionTable)
        .where(eq(SessionTable.id, sessionID)).get()
      expect(session?.cost).toBe(0)

      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      expect(yield* fixture.bus.publish(SessionEvent.Step.Settled, settled).pipe(Effect.exit))
        .toMatchObject({ _tag: "Failure" })
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* fixture.db.select().from(SessionPendingStepTable).all()).toHaveLength(0)
    }),
  )

  it.effect("accepts a valid answer exactly once without advancing the sequence on duplicate", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const input = resolve(fixture.generation, {
        status: "answered",
        answer: { q0: "Yes" },
      })
      yield* fixture.bus.publish(SessionEvent.QuestionResolution.Resolved, input)
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      expect(yield* fixture.db.select().from(SessionQuestionTable).get()).toMatchObject({
        status: "answered",
        answer: { q0: "Yes" },
        cancel_message: null,
      })
      const completed = yield* originalTool
      expect(completed).toMatchObject({
        type: "tool",
        id: "call_owner",
        state: {
          status: "completed",
          metadata: { answers: [["Yes"]] },
        },
      })
      expect(completed?.time.completed).toBeDefined()
      expect(completed?.state.status).toBe("completed")
      if (completed?.state.status === "completed") {
        expect(completed.state.content.length).toBeGreaterThan(0)
      }

      expect(yield* fixture.bus.publish(SessionEvent.QuestionResolution.Resolved, input).pipe(Effect.exit))
        .toMatchObject({ _tag: "Failure" })
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      expect(yield* originalTool).toEqual(completed)
    }),
  )

  for (const terminal of [
    { status: "answered", answer: { q0: "Yes" } },
    { status: "cancelled", message: "" },
  ] as const) {
    it.effect(`rolls back ${terminal.status} when tool finalization fails`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
        const waiting = yield* originalTool
        expect(waiting).toMatchObject({
          type: "tool",
          id: "call_owner",
          state: { status: "waiting" },
        })

        yield* fixture.db.run(sql`
          CREATE TRIGGER reject_question_tool_finalization
          BEFORE UPDATE ON session_message
          WHEN NEW.id = 'msg_step_owner'
          BEGIN
            SELECT RAISE(ABORT, 'injected question tool finalization failure');
          END
        `)

        const result = yield* fixture.bus.publish(
          SessionEvent.QuestionResolution.Resolved,
          resolve(fixture.generation, terminal),
        ).pipe(Effect.exit)

        expect(result._tag).toBe("Failure")
        expect(yield* fixture.db.select().from(SessionQuestionTable).get()).toMatchObject({
          status: "pending",
          answer: null,
          cancel_message: null,
        })
        expect(yield* originalTool).toEqual(waiting)
        expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      }),
    )
  }

  it.effect("rejects invalid answers without changing the row or durable sequence", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      const invalid: Form.Answer[] = [
        { q0: ["Yes"] },
        { unexpected: "Yes" },
      ]
      for (const answer of invalid) {
        expect(yield* fixture.bus.publish(
          SessionEvent.QuestionResolution.Resolved,
          resolve(fixture.generation, { status: "answered", answer }),
        ).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      }
      expect(yield* fixture.db.select().from(SessionQuestionTable).get()).toMatchObject({
        status: "pending",
        answer: null,
        cancel_message: null,
      })
    }),
  )

  it.effect("rejects stale generations and mismatched call ownership", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      const terminal = { status: "cancelled" as const }
      for (const input of [
        resolve(fixture.generation + 1, terminal),
        { ...resolve(fixture.generation, terminal), callID: "other_call" },
        { ...resolve(fixture.generation, terminal), assistantMessageID: otherMessageID },
        { ...resolve(fixture.generation, terminal), sessionID: otherSessionID },
      ]) {
        expect(yield* fixture.bus.publish(SessionEvent.QuestionResolution.Resolved, input)
          .pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      }
      expect(yield* fixture.db.select().from(SessionQuestionTable).get()).toMatchObject({
        status: "pending",
      })
    }),
  )

  it.effect("preserves an explicitly empty cancellation message", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      yield* fixture.bus.publish(
        SessionEvent.QuestionResolution.Resolved,
        resolve(fixture.generation, { status: "cancelled", message: "" }),
      )
      expect(yield* fixture.db.select().from(SessionQuestionTable).get()).toMatchObject({
        status: "cancelled",
        answer: null,
        cancel_message: "",
      })
      expect(yield* originalTool).toMatchObject({
        type: "tool",
        id: "call_owner",
        state: {
          status: "error",
          error: { type: "QuestionTool.Cancelled", message: "" },
        },
      })
      expect((yield* originalTool)?.time.completed).toBeDefined()
    }),
  )
})

describe("Step ownership", () => {
  it.effect("requires each child to reference the exact Session, assistant and generation with no NULL bypass", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const invalid = [
        [otherSessionID, assistantMessageID, fixture.generation],
        [sessionID, otherMessageID, fixture.generation],
        [sessionID, assistantMessageID, fixture.generation + 1],
        [null, assistantMessageID, fixture.generation],
        [sessionID, null, fixture.generation],
        [sessionID, assistantMessageID, null],
      ] as const
      yield* Effect.forEach(invalid, (owner) =>
        Effect.gen(function* () {
          expect(
            yield* fixture.db
              .run(
                sql`INSERT INTO session_pending_step (session_id, assistant_message_id, generation, data)
              VALUES (${owner[0]}, ${owner[1]}, ${owner[2]}, ${JSON.stringify(parkedData(sessionID, assistantMessageID, fixture.generation))})`,
              )
              .pipe(Effect.exit),
          ).toMatchObject({ _tag: "Failure" })
          expect(
            yield* fixture.db
              .run(
                sql`INSERT INTO session_question (id, session_id, assistant_message_id, generation, call_id, prepared)
              VALUES ('question', ${owner[0]}, ${owner[1]}, ${owner[2]}, 'call_owner', ${JSON.stringify(prepared)})`,
              )
              .pipe(Effect.exit),
          ).toMatchObject({ _tag: "Failure" })
        }),
      )
      expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
      expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([])
      // Questions can outlive the pending Step and reference the message directly.
      yield* fixture.db.insert(SessionQuestionTable).values({
        id: Form.ID.make("frm_owner"),
        session_id: sessionID,
        assistant_message_id: assistantMessageID,
        generation: fixture.generation,
        call_id: "call_owner",
        prepared,
      })
      expect(yield* fixture.db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
    }),
  )

  it.effect("allows one pending Step per Session and independent pending Steps in other Sessions", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const other = yield* start(sessionID, otherMessageID)
      const independent = yield* start(otherSessionID, SessionMessage.ID.make("msg_independent"))
      yield* fixture.db
        .insert(SessionPendingStepTable)
        .values({ session_id: sessionID, assistant_message_id: assistantMessageID, generation: fixture.generation, data: parkedData(sessionID, assistantMessageID, fixture.generation) })
      expect(
        yield* fixture.db
          .insert(SessionPendingStepTable)
          .values({
            session_id: sessionID,
            assistant_message_id: otherMessageID,
            generation: other.durable.seq,
            data: parkedData(sessionID, otherMessageID, other.durable.seq),
          })
          .pipe(Effect.exit),
      ).toMatchObject({ _tag: "Failure" })
      yield* fixture.db.insert(SessionPendingStepTable).values({
        session_id: otherSessionID,
        assistant_message_id: independent.data.assistantMessageID,
        generation: independent.durable.seq,
        data: parkedData(otherSessionID, independent.data.assistantMessageID, independent.durable.seq),
      })
      expect(yield* fixture.db.select().from(SessionPendingStepTable)).toHaveLength(2)
    }),
  )

  it.effect(
    "blocks same-owner and different-owner starts while a Step is pending and rolls back their projections",
    () =>
      Effect.gen(function* () {
        const fixture = yield* seed
        yield* fixture.db
          .insert(SessionPendingStepTable)
          .values({ session_id: sessionID, assistant_message_id: assistantMessageID, generation: fixture.generation, data: parkedData(sessionID, assistantMessageID, fixture.generation) })
        const before = yield* fixture.db.select().from(SessionMessageTable)
        const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
        yield* Effect.forEach([assistantMessageID, otherMessageID], (id) =>
          Effect.gen(function* () {
            expect(yield* start(sessionID, id).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
            expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
            expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
          }),
        )
      }),
  )

  it.effect(
    "reuses an unreferenced generation but retained Questions prevent replacement after pending consumption",
    () =>
      Effect.gen(function* () {
        const fixture = yield* seed
        const reused = yield* start(sessionID, assistantMessageID)
        const owner = {
          session_id: sessionID,
          assistant_message_id: assistantMessageID,
          generation: reused.durable.seq,
        }
        yield* fixture.db.insert(SessionPendingStepTable).values({ ...owner, data: parkedData(sessionID, assistantMessageID, reused.durable.seq) })
        yield* fixture.db.insert(SessionQuestionTable).values({ id: Form.ID.make("frm_retained"), ...owner, call_id: "call_retained", prepared })
        yield* fixture.db.delete(SessionPendingStepTable).where(eq(SessionPendingStepTable.session_id, sessionID))
        const before = yield* fixture.db.select().from(SessionMessageTable)
        expect(yield* start(sessionID, assistantMessageID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
        expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
        expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([
          {
            id: Form.ID.make("frm_retained"),
            ...owner,
            call_id: "call_retained",
            prepared,
            status: "pending",
            answer: null,
            cancel_message: null,
          },
        ])
        expect(
          yield* fixture.db
            .update(SessionMessageTable)
            .set({ step_started_seq: null })
            .where(eq(SessionMessageTable.id, assistantMessageID))
            .pipe(Effect.exit),
        ).toMatchObject({ _tag: "Failure" })
        yield* fixture.db.delete(SessionQuestionTable)
        const next = yield* start(sessionID, assistantMessageID)
        expect(next.durable.seq).toBeGreaterThan(reused.durable.seq)
      }),
  )

  it.effect("stamps durable sequence only on the exact assistant owner, including reuse of an older message", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      const second = yield* start(sessionID, otherMessageID)
      const independent = yield* start(otherSessionID, SessionMessage.ID.make("msg_independent"))
      // A historical assistant has no inferred generation, even when its seq happens to match a start.
      yield* fixture.db.run(sql`UPDATE session_message SET step_started_seq = NULL WHERE id = ${otherMessageID}`)
      const reused = yield* start(sessionID, assistantMessageID)
      expect(reused.durable.seq).toBeGreaterThan(fixture.generation)
      expect(
        yield* fixture.db
          .select({ id: SessionMessageTable.id, generation: SessionMessageTable.step_started_seq })
          .from(SessionMessageTable)
          .orderBy(asc(SessionMessageTable.id)),
      ).toEqual([
        { id: independent.data.assistantMessageID, generation: independent.durable.seq },
        { id: otherMessageID, generation: null },
        { id: assistantMessageID, generation: reused.durable.seq },
      ])
      expect(
        yield* fixture.db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.id, assistantMessageID), eq(SessionMessageTable.session_id, sessionID)))
          .get(),
      ).toMatchObject({ seq: fixture.generation })
      expect(second.durable.seq).toBeGreaterThan(fixture.generation)
    }),
  )

  it.effect("rejects a non-assistant target without stamping another assistant", () =>
    Effect.gen(function* () {
      const fixture = yield* seed
      yield* fixture.db.insert(SessionMessageTable).values({
        id: otherMessageID,
        session_id: sessionID,
        type: "synthetic",
        seq: 100,
        data: { text: "legacy", time: { created: 0 } },
      })
      const before = yield* fixture.db.select().from(SessionMessageTable)
      expect(yield* start(sessionID, otherMessageID).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" })
      expect(yield* fixture.db.select().from(SessionMessageTable)).toEqual(before)
    }),
  )
})
