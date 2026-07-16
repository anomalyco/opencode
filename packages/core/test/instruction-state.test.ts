import { describe, expect } from "bun:test"
import { and, asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Instructions } from "@opencode-ai/core/instructions"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstructionState } from "@opencode-ai/core/session/instruction-state"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { InstructionBlobTable, InstructionStateTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

const source = (name: string, read: Effect.Effect<string | Instructions.Unavailable | Instructions.Removed>) =>
  Instructions.make({
    key: Instructions.Key.make(name),
    codec: Schema.toCodecJson(Schema.String),
    read,
    render: {
      initial: String,
      changed: (_previous, current) => current,
      removed: (previous) => `Removed ${previous}`,
    },
  })

const setup = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
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
        slug: "instruction-state-test",
        directory: "/project",
        title: "Instruction state test",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return { db, events: yield* EventV2.Service }
  })

const instructionEvents = (db: Database.Interface["db"], sessionID: SessionSchema.ID) =>
  db
    .select()
    .from(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, "session.instructions.updated.2")))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)

describe("InstructionState", () => {
  it.effect("observes each source once without publishing events or inserting blobs", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("ses_instruction_observe")
      const { db, events } = yield* setup(sessionID)
      const reads = { first: 0, second: 0 }
      const instructions = Instructions.combine([
        source(
          "test/first",
          Effect.sync(() => {
            reads.first++
            return "first"
          }),
        ),
        source(
          "test/second",
          Effect.sync(() => {
            reads.second++
            return "second"
          }),
        ),
      ])
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "session.instructions.updated") published.push(event)
        }),
      )

      const observation = yield* InstructionState.observe(db, instructions, sessionID)
      yield* unsubscribe

      expect(reads).toEqual({ first: 1, second: 1 })
      expect(observation).toEqual({
        sessionID,
        initial: true,
        current: {
          "test/first": Instructions.hash("first"),
          "test/second": Instructions.hash("second"),
        },
        delta: {
          "test/first": Instructions.hash("first"),
          "test/second": Instructions.hash("second"),
        },
        blobs: {
          [Instructions.hash("first")]: "first",
          [Instructions.hash("second")]: "second",
        },
      })
      expect(published).toEqual([])
      expect(yield* instructionEvents(db, sessionID)).toEqual([])
      expect(yield* db.select().from(InstructionBlobTable).all().pipe(Effect.orDie)).toEqual([])
    }),
  )

  it.effect("commits initial metadata and changed and removed deltas without rereading sources", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("ses_instruction_commit")
      const { db, events } = yield* setup(sessionID)
      let current = "initial"
      let retired: string | Instructions.Removed = "retired"
      let reads = 0
      const instructions = Instructions.combine([
        source(
          "test/current",
          Effect.sync(() => {
            reads++
            return current
          }),
        ),
        source(
          "test/retired",
          Effect.sync(() => {
            reads++
            return retired
          }),
        ),
      ])
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === "session.instructions.updated") published.push(event)
        }),
      )

      const initial = yield* InstructionState.observe(db, instructions, sessionID)
      expect(reads).toBe(2)
      yield* InstructionState.commit(db, events, initial)
      expect(reads).toBe(2)

      current = "changed"
      retired = Instructions.removed
      const changed = yield* InstructionState.observe(db, instructions, sessionID)
      expect(reads).toBe(4)
      expect(changed).toMatchObject({
        sessionID,
        initial: false,
        current: { "test/current": Instructions.hash("changed") },
        delta: {
          "test/current": Instructions.hash("changed"),
          "test/retired": "removed",
        },
        blobs: { [Instructions.hash("changed")]: "changed" },
      })
      yield* InstructionState.commit(db, events, changed)
      expect(reads).toBe(4)
      yield* unsubscribe

      expect(published).toHaveLength(2)
      expect(published[0]?.metadata).toEqual({ instructions: { initial: true } })
      expect(published[1]?.metadata).toBeUndefined()
      expect((yield* instructionEvents(db, sessionID)).map((event) => event.data.delta)).toEqual([
        {
          "test/current": Instructions.hash("initial"),
          "test/retired": Instructions.hash("retired"),
        },
        {
          "test/current": Instructions.hash("changed"),
          "test/retired": "removed",
        },
      ])
      expect(yield* db.select().from(InstructionStateTable).get().pipe(Effect.orDie)).toMatchObject({
        initial_values: {
          "test/current": Instructions.hash("initial"),
          "test/retired": Instructions.hash("retired"),
        },
        current_values: { "test/current": Instructions.hash("changed") },
      })
      expect(
        Object.fromEntries(
          (yield* db.select().from(InstructionBlobTable).all().pipe(Effect.orDie)).map((row) => [row.hash, row.value]),
        ),
      ).toEqual({
        [Instructions.hash("initial")]: "initial",
        [Instructions.hash("retired")]: "retired",
        [Instructions.hash("changed")]: "changed",
      })
    }),
  )

  it.effect("keeps no-op observations free of events and blobs", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("ses_instruction_noop")
      const { db, events } = yield* setup(sessionID)
      const instructions = source("test/context", Effect.succeed("unchanged"))
      yield* InstructionState.prepare(db, events, instructions, sessionID)
      const beforeEvents = yield* instructionEvents(db, sessionID)
      const beforeBlobs = yield* db.select().from(InstructionBlobTable).all().pipe(Effect.orDie)

      const observation = yield* InstructionState.observe(db, instructions, sessionID)
      expect(observation).toEqual({
        sessionID,
        initial: false,
        current: { "test/context": Instructions.hash("unchanged") },
        delta: {},
        blobs: {},
      })
      yield* InstructionState.commit(db, events, observation)

      expect(yield* instructionEvents(db, sessionID)).toEqual(beforeEvents)
      expect(yield* db.select().from(InstructionBlobTable).all().pipe(Effect.orDie)).toEqual(beforeBlobs)
    }),
  )

  it.effect("keeps prepare equivalent to observe followed by commit", () =>
    Effect.gen(function* () {
      const observedSessionID = SessionSchema.ID.make("ses_instruction_composed")
      const preparedSessionID = SessionSchema.ID.make("ses_instruction_prepared")
      const { db, events } = yield* setup(observedSessionID)
      yield* setup(preparedSessionID)
      let value: string | Instructions.Removed = "initial"
      let observedReads = 0
      let preparedReads = 0
      const observedInstructions = source(
        "test/context",
        Effect.sync(() => {
          observedReads++
          return value
        }),
      )
      const preparedInstructions = source(
        "test/context",
        Effect.sync(() => {
          preparedReads++
          return value
        }),
      )

      for (const next of ["initial", "changed", "changed", Instructions.removed] as const) {
        value = next
        yield* InstructionState.observe(db, observedInstructions, observedSessionID).pipe(
          Effect.flatMap((observation) => InstructionState.commit(db, events, observation)),
        )
        yield* InstructionState.prepare(db, events, preparedInstructions, preparedSessionID)
      }

      expect(observedReads).toBe(4)
      expect(preparedReads).toBe(4)
      expect((yield* instructionEvents(db, observedSessionID)).map((event) => event.data.delta)).toEqual(
        (yield* instructionEvents(db, preparedSessionID)).map((event) => event.data.delta),
      )
      const states = yield* db.select().from(InstructionStateTable).orderBy(asc(InstructionStateTable.session_id)).all()
      expect(states).toHaveLength(2)
      expect(
        states.map((state) => ({
          epoch_start: state.epoch_start,
          through_seq: state.through_seq,
          initial_values: state.initial_values,
          current_values: state.current_values,
        })),
      ).toEqual([
        {
          epoch_start: 0,
          through_seq: 2,
          initial_values: { "test/context": Instructions.hash("initial") },
          current_values: {},
        },
        {
          epoch_start: 0,
          through_seq: 2,
          initial_values: { "test/context": Instructions.hash("initial") },
          current_values: {},
        },
      ])
    }),
  )
})
