import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { Instructions } from "@opencode-ai/core/instructions"
import { it } from "../lib/effect"

const key = Instructions.Key.make
const stringContext = (input: {
  key: string
  value: string | Instructions.Unavailable
  baseline?: (value: string) => string
  update?: (previous: string, current: string) => string
  removed?: (value: string) => string
}) =>
  Instructions.make({
    key: key(input.key),
    codec: Schema.toCodecJson(Schema.String),
    load: Effect.succeed(input.value),
    baseline: input.baseline ?? String,
    update: input.update ?? ((_previous, current) => current),
    removed: input.removed,
  })

describe("Instructions", () => {
  it.effect("stores the canonical JSON encoding of the loaded value", () =>
    Effect.gen(function* () {
      const context = Instructions.make({
        key: key("core/date"),
        codec: Schema.toCodecJson(Schema.DateFromString),
        load: Effect.succeed(new Date("2026-06-03T12:00:00.000Z")),
        baseline: (date) => date.toISOString(),
        update: (_previous, date) => date.toISOString(),
        removed: () => "Date removed",
      })

      expect((yield* Instructions.initialize(context)).applied["core/date"].value).toBe("2026-06-03T12:00:00.000Z")
    }),
  )

  it.effect("loads once and initializes a baseline with the applied values", () =>
    Effect.gen(function* () {
      let loads = 0
      const context = Instructions.combine([
        Instructions.make({
          key: key("core/date"),
          codec: Schema.toCodecJson(Schema.String),
          load: Effect.sync(() => {
            loads++
            return "2026-06-03"
          }),
          baseline: (date) => `Today's date is ${date}.`,
          update: (previous, current) => `The date changed from ${previous} to ${current}.`,
          removed: () => "The date was removed.",
        }),
        stringContext({ key: "core/location", value: "/repo", baseline: (value) => `Directory: ${value}` }),
      ])

      expect(yield* Instructions.initialize(context)).toEqual({
        text: "Today's date is 2026-06-03.\n\nDirectory: /repo",
        applied: {
          "core/date": { value: "2026-06-03", removed: "The date was removed." },
          "core/location": { value: "/repo" },
        },
      })
      expect(loads).toBe(1)
    }),
  )

  it.effect("renders updates only after a structured value changes", () =>
    Effect.gen(function* () {
      const previous = {
        "core/date": { value: "2026-06-03", removed: "The date was removed." },
        "core/location": { value: "/repo", removed: "Removed: /repo" },
      }
      const changed = Instructions.combine([
        stringContext({
          key: "core/date",
          value: "2026-06-04",
          update: (before, current) => `The date changed from ${before} to ${current}.`,
          removed: () => "The date was removed.",
        }),
        stringContext({ key: "core/location", value: "/repo" }),
      ])

      expect(yield* Instructions.reconcile(changed, previous)).toEqual({
        _tag: "Updated",
        text: "The date changed from 2026-06-03 to 2026-06-04.",
        applied: {
          "core/date": { value: "2026-06-04", removed: "The date was removed." },
          "core/location": { value: "/repo", removed: "Removed: /repo" },
        },
      })

      expect(
        yield* Instructions.reconcile(
          Instructions.combine([
            stringContext({ key: "core/date", value: "2026-06-03", removed: () => "The date was removed." }),
            stringContext({ key: "core/location", value: "/repo" }),
          ]),
          previous,
        ),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("uses the baseline for a newly added source", () =>
    Effect.gen(function* () {
      const context = stringContext({
        key: "core/skills",
        value: "effect",
        baseline: (skill) => `Available skill: ${skill}`,
      })

      expect(yield* Instructions.reconcile(context, {})).toEqual({
        _tag: "Updated",
        text: "Available skill: effect",
        applied: { "core/skills": { value: "effect" } },
      })
    }),
  )

  it.effect("retains the belief while a source is temporarily unavailable", () =>
    Effect.gen(function* () {
      const previous = { "core/remote": { value: "instructions", removed: "Instructions removed" } }
      const context = stringContext({ key: "core/remote", value: Instructions.unavailable })

      expect(yield* Instructions.reconcile(context, previous)).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("blocks initialization while a source is unavailable", () =>
    Effect.gen(function* () {
      const exit = yield* Instructions.initialize(
        stringContext({ key: "core/remote", value: Instructions.unavailable }),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(Cause.squash(exit.cause)).toEqual(new Instructions.InitializationBlocked({ keys: [key("core/remote")] }))
    }),
  )

  it.effect("emits the previously stored removal message", () =>
    Effect.gen(function* () {
      expect(
        yield* Instructions.reconcile(Instructions.empty, {
          "core/instructions": { value: "contents", removed: "Instructions removed; stop applying them." },
        }),
      ).toEqual({
        _tag: "Updated",
        text: "Instructions removed; stop applying them.",
        applied: {},
      })
    }),
  )

  it.effect("retains an unannounced removal silently", () =>
    Effect.gen(function* () {
      expect(yield* Instructions.reconcile(Instructions.empty, { "core/date": { value: "2026-06-04" } })).toEqual({
        _tag: "Unchanged",
      })

      // The retained belief survives alongside other updates.
      expect(
        yield* Instructions.reconcile(stringContext({ key: "core/skills", value: "effect" }), {
          "core/date": { value: "2026-06-04" },
        }),
      ).toEqual({
        _tag: "Updated",
        text: "effect",
        applied: {
          "core/skills": { value: "effect" },
          "core/date": { value: "2026-06-04" },
        },
      })
    }),
  )

  it.effect("renders multiple removals in stable key order", () =>
    Effect.gen(function* () {
      expect(
        yield* Instructions.reconcile(Instructions.empty, {
          "core/z": { value: "z", removed: "Removed z" },
          "core/a": { value: "a", removed: "Removed a" },
        }),
      ).toMatchObject({ _tag: "Updated", text: "Removed a\n\nRemoved z" })
    }),
  )

  it.effect("rejects empty model-visible renderings", () =>
    Effect.gen(function* () {
      const exit = yield* Instructions.initialize(
        stringContext({ key: "core/empty", value: "value", baseline: () => "" }),
      ).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("rendered an empty baseline")
    }),
  )

  it.effect("re-announces the baseline when a stored value no longer decodes", () =>
    Effect.gen(function* () {
      expect(
        yield* Instructions.reconcile(stringContext({ key: "core/date", value: "2026-06-04" }), {
          "core/date": { value: 42, removed: "Date removed" },
        }),
      ).toEqual({
        _tag: "Updated",
        text: "2026-06-04",
        applied: { "core/date": { value: "2026-06-04" } },
      })
    }),
  )

  it.effect("renders undecodable re-announcements alongside other updates", () =>
    Effect.gen(function* () {
      const context = Instructions.combine([
        stringContext({
          key: "core/date",
          value: "2026-06-04",
          update: (before, current) => `${before} -> ${current}`,
        }),
        stringContext({ key: "core/location", value: "/repo" }),
      ])

      expect(
        yield* Instructions.reconcile(context, {
          "core/date": { value: "2026-06-03" },
          "core/location": { value: 42 },
        }),
      ).toEqual({
        _tag: "Updated",
        text: "2026-06-03 -> 2026-06-04\n\n/repo",
        applied: {
          "core/date": { value: "2026-06-04" },
          "core/location": { value: "/repo" },
        },
      })
    }),
  )

  it.effect("rebaselines from one coherent source observation", () =>
    Effect.gen(function* () {
      let loads = 0
      const context = Instructions.make({
        key: key("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.sync(() => {
          loads++
          return "2026-06-04"
        }),
        baseline: String,
        update: (_previous, current) => current,
      })

      expect(yield* Instructions.rebaseline(context, { "core/date": { value: "2026-06-03" } })).toEqual({
        text: "2026-06-04",
        applied: { "core/date": { value: "2026-06-04" } },
      })
      expect(loads).toBe(1)
    }),
  )

  it.effect("rebaselines an unavailable source from the last-applied belief", () =>
    Effect.gen(function* () {
      const context = Instructions.combine([
        stringContext({ key: "core/date", value: "2026-06-04" }),
        stringContext({
          key: "core/remote",
          value: Instructions.unavailable,
          baseline: (value) => `Instructions: ${value}`,
        }),
      ])

      expect(
        yield* Instructions.rebaseline(context, {
          "core/remote": { value: "contents", removed: "Instructions removed" },
        }),
      ).toEqual({
        text: "2026-06-04\n\nInstructions: contents",
        applied: {
          "core/date": { value: "2026-06-04" },
          "core/remote": { value: "contents", removed: "Instructions removed" },
        },
      })
    }),
  )

  it.effect("drops undecodable beliefs and removed sources at rebaseline", () =>
    Effect.gen(function* () {
      const context = stringContext({ key: "core/remote", value: Instructions.unavailable })

      // Undecodable belief cannot be restated; removed source entries self-clean.
      expect(
        yield* Instructions.rebaseline(context, {
          "core/remote": { value: 42 },
          "core/gone": { value: "gone" },
        }),
      ).toEqual({ text: "", applied: {} })
    }),
  )

  it.effect("diffs list values by key with a changed comparator", () =>
    Effect.sync(() => {
      const previous = [
        { name: "effect", description: "Build with Effect" },
        { name: "debugging", description: "Diagnose bugs" },
        { name: "retired", description: "Old" },
      ]
      const current = [
        { name: "effect", description: "Build with Effect v4" },
        { name: "debugging", description: "Diagnose bugs" },
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

  it.effect("rejects duplicate source keys", () =>
    Effect.sync(() => {
      expect(() =>
        Instructions.combine([
          stringContext({ key: "core/date", value: "one" }),
          stringContext({ key: "core/date", value: "two" }),
        ]),
      ).toThrow(new Instructions.DuplicateKeyError({ key: key("core/date") }))
    }),
  )

  it.effect("combines instructions in order", () =>
    Effect.gen(function* () {
      expect(
        (yield* Instructions.initialize(
          Instructions.combine([
            stringContext({ key: "core/date", value: "date" }),
            stringContext({ key: "core/location", value: "location" }),
          ]),
        )).text,
      ).toBe("date\n\nlocation")
    }),
  )

  it.effect("requires namespaced source keys", () =>
    Effect.sync(() => {
      const decodeKey = Schema.decodeUnknownSync(Instructions.Key)

      expect(decodeKey("core/date")).toBe(key("core/date"))
      expect(() => decodeKey("date")).toThrow()
    }),
  )

  it.effect("requires namespaced applied keys", () =>
    Effect.sync(() => {
      const decodeApplied = Schema.decodeUnknownSync(Instructions.Applied)

      expect(Object.keys(decodeApplied({ "core/date": { value: "date" } }))).toEqual(["core/date"])
      expect(() => decodeApplied({ date: { value: "date" } })).toThrow()
      expect(() => decodeApplied({ "core/date": { value: "date", removed: "" } })).toThrow()
    }),
  )
})
