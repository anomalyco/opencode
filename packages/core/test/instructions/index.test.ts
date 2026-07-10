import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { Instructions } from "@opencode-ai/core/instructions"
import { it } from "../lib/effect"

const key = (value: string) => Instructions.Key.make(value)
const source = (input: {
  key: string
  value: string | Instructions.Unavailable | Instructions.Removed
  initial?: (value: string) => string
  changed?: (previous: string, current: string) => string
  removed?: (value: string) => string
}) =>
  Instructions.make({
    key: key(input.key),
    codec: Schema.toCodecJson(Schema.String),
    read: Effect.succeed(input.value),
    render: {
      initial: input.initial ?? String,
      changed: input.changed ?? ((_previous, current) => current),
      removed: input.removed,
    },
  })

describe("Instructions", () => {
  it.effect("reads each source once and derives the initial delta and text", () =>
    Effect.gen(function* () {
      let reads = 0
      const instructions = Instructions.make({
        key: key("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        read: Effect.sync(() => {
          reads++
          return "2026-07-09"
        }),
        render: {
          initial: (date) => `Today's date: ${date}`,
          changed: (previous, current) => `The date changed from ${previous} to ${current}`,
        },
      })

      const admitted = yield* Instructions.read(instructions).pipe(Effect.flatMap(Instructions.diff))
      const hash = Instructions.hash("2026-07-09")

      expect(reads).toBe(1)
      expect(admitted).toEqual({
        delta: { "core/date": hash },
        blobs: { [hash]: "2026-07-09" },
      })
      expect(Instructions.renderInitial(instructions, { "core/date": "2026-07-09" })).toBe("Today's date: 2026-07-09")
    }),
  )

  it.effect("derives no delta when the encoded value is unchanged", () =>
    Effect.gen(function* () {
      const instructions = source({ key: "core/date", value: "2026-07-09" })
      const admitted = yield* Instructions.read(instructions).pipe(
        Effect.flatMap((observed) => Instructions.diff(observed, { "core/date": Instructions.hash("2026-07-09") })),
      )

      expect(admitted).toEqual({ delta: {}, blobs: {} })
    }),
  )

  it.effect("renders a changed value from stored values", () =>
    Effect.gen(function* () {
      const instructions = source({
        key: "core/date",
        value: "2026-07-10",
        changed: (previous, current) => `The date changed from ${previous} to ${current}`,
      })
      const admitted = yield* Instructions.read(instructions).pipe(
        Effect.flatMap((observed) => Instructions.diff(observed, { "core/date": Instructions.hash("2026-07-09") })),
      )

      expect(admitted.delta).toEqual({ "core/date": Instructions.hash("2026-07-10") })
      expect(
        Instructions.renderUpdate(
          instructions,
          { "core/date": "2026-07-09" },
          { "core/date": Option.some("2026-07-10") },
        ),
      ).toBe("The date changed from 2026-07-09 to 2026-07-10")
    }),
  )

  it.effect("admits and renders an observed removal", () =>
    Effect.gen(function* () {
      const instructions = source({
        key: "core/remote",
        value: Instructions.removed,
        removed: (previous) => `Stop applying ${previous}`,
      })
      const admitted = yield* Instructions.read(instructions).pipe(
        Effect.flatMap((observed) => Instructions.diff(observed, { "core/remote": Instructions.hash("instructions") })),
      )

      expect(admitted).toEqual({ delta: { "core/remote": "removed" }, blobs: {} })
      expect(
        Instructions.renderUpdate(instructions, { "core/remote": "instructions" }, { "core/remote": Option.none() }),
      ).toBe("Stop applying instructions")
    }),
  )

  it.effect("treats JSON null as a value rather than a removal", () =>
    Effect.gen(function* () {
      const instructions = Instructions.make<Schema.Json>({
        key: key("api/value"),
        codec: Schema.toCodecJson(Schema.Json),
        read: Effect.succeed(null),
        render: {
          initial: String,
          changed: (_previous, current) => String(current),
          removed: () => "removed",
        },
      })
      const admitted = yield* Instructions.read(instructions).pipe(
        Effect.flatMap((observed) => Instructions.diff(observed, { "api/value": Instructions.hash("previous") })),
      )

      expect(admitted).toEqual({
        delta: { "api/value": Instructions.hash(null) },
        blobs: { [Instructions.hash(null)]: null },
      })
      expect(
        Instructions.renderUpdate(instructions, { "api/value": "previous" }, { "api/value": Option.some(null) }),
      ).toBe("null")
      expect(Instructions.applyDelta({ "api/value": "previous" }, { "api/value": Option.some(null) })).toEqual({
        "api/value": null,
      })
    }),
  )

  it.effect("blocks the initial delta while any source is unavailable", () =>
    Effect.gen(function* () {
      const exit = yield* Instructions.read(source({ key: "core/remote", value: Instructions.unavailable })).pipe(
        Effect.flatMap(Instructions.diff),
        Effect.exit,
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toEqual(new Instructions.InitializationBlocked({ keys: [key("core/remote")] }))
    }),
  )

  it.effect("keeps the stored value while a source is unavailable mid-session", () =>
    Effect.gen(function* () {
      const admitted = yield* Instructions.read(source({ key: "core/remote", value: Instructions.unavailable })).pipe(
        Effect.flatMap((observed) => Instructions.diff(observed, { "core/remote": Instructions.hash("instructions") })),
      )

      expect(admitted).toEqual({ delta: {}, blobs: {} })
    }),
  )

  it.effect("does not infer removal when a source is absent from the current version", () =>
    Effect.gen(function* () {
      const admitted = yield* Instructions.read(Instructions.empty).pipe(
        Effect.flatMap((observed) =>
          Instructions.diff(observed, { "core/retired": Instructions.hash("old instructions") }),
        ),
      )

      expect(admitted).toEqual({ delta: {}, blobs: {} })
    }),
  )

  it.effect("renders a newly added source with its initial renderer", () =>
    Effect.gen(function* () {
      const instructions = source({
        key: "core/skills",
        value: "effect",
        initial: (skill) => `Available skill: ${skill}`,
      })

      expect(Instructions.renderUpdate(instructions, {}, { "core/skills": Option.some("effect") })).toBe(
        "Available skill: effect",
      )
    }),
  )

  it.effect("hashes objects independently of key order", () =>
    Effect.sync(() => {
      expect(Instructions.hash({ a: 1, b: { x: true, y: false } })).toBe(
        Instructions.hash({ b: { y: false, x: true }, a: 1 }),
      )
    }),
  )

  it.effect("renders sources in composition order", () =>
    Effect.sync(() => {
      const instructions = Instructions.combine([
        source({ key: "core/date", value: "date" }),
        source({ key: "core/location", value: "location" }),
      ])

      expect(Instructions.renderInitial(instructions, { "core/date": "date", "core/location": "location" })).toBe(
        "date\n\nlocation",
      )
    }),
  )

  it.effect("rejects duplicate source keys", () =>
    Effect.sync(() => {
      expect(() =>
        Instructions.combine([source({ key: "core/date", value: "one" }), source({ key: "core/date", value: "two" })]),
      ).toThrow(new Instructions.DuplicateKeyError({ key: key("core/date") }))
    }),
  )

  it.effect("rejects empty model-visible renderings", () =>
    Effect.sync(() => {
      const instructions = source({ key: "core/empty", value: "value", initial: () => "" })

      expect(() => Instructions.renderInitial(instructions, { "core/empty": "value" })).toThrow(
        "Instruction source core/empty rendered an empty initial",
      )
    }),
  )

  it.effect("diffs list values by key", () =>
    Effect.sync(() => {
      const previous = [
        { name: "effect", description: "Build with Effect" },
        { name: "retired", description: "Old" },
      ]
      const current = [
        { name: "effect", description: "Build with Effect v4" },
        { name: "writing", description: "Write prose" },
      ]

      expect(
        Instructions.diffByKey(
          previous,
          current,
          (value) => value.name,
          (before, after) => before.description !== after.description,
        ),
      ).toEqual({
        added: [{ name: "writing", description: "Write prose" }],
        removed: [{ name: "retired", description: "Old" }],
        changed: [
          {
            previous: { name: "effect", description: "Build with Effect" },
            current: { name: "effect", description: "Build with Effect v4" },
          },
        ],
      })
    }),
  )
})
