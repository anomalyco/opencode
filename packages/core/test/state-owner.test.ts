import { expect } from "bun:test"
import { Effect } from "effect"
import { State } from "@opencode-ai/core/state"
import { it } from "./lib/effect"

it.effect("detaches every registration of a failed owner and refreshes every affected domain", () =>
  Effect.gen(function* () {
    const notices: string[] = []
    const failures: State.Failure[] = []
    let refresh = Effect.void
    let fail = false
    let calls = 0
    const owned = State.owner((failure, changed) => {
      failures.push(failure)
      refresh = changed
    })
    const first = State.create({
      name: "first",
      initial: () => ({ values: [] as string[] }),
      editor: (value) => value,
      notify: () => Effect.sync(() => void notices.push("first")),
    })
    const second = State.create({
      name: "second",
      initial: () => ({ values: [] as string[] }),
      editor: (value) => value,
      notify: () => Effect.sync(() => void notices.push("second")),
    })
    yield* first.transform((editor) => editor.values.push("healthy"))
    const registration = yield* first.transform((editor) => editor.values.push("owned")).pipe(owned)
    yield* second
      .transform((editor) => {
        calls++
        editor.values.push("partial")
        if (fail) throw new Error("broken")
      })
      .pipe(owned)
    const before = first.get()
    notices.length = 0
    fail = true
    yield* second.reload()

    expect(first.get().values).toEqual(["healthy"])
    expect(second.get().values).toEqual([])
    expect(before.values).toEqual(["healthy", "owned"])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.state).toBe("second")
    expect(calls).toBe(2)

    notices.length = 0
    yield* State.batch(refresh)
    expect(notices.toSorted()).toEqual(["first", "second"])
    yield* registration.dispose
    expect(notices).toHaveLength(2)
    yield* first.transform((editor) => editor.values.push("resurrected")).pipe(owned)
    expect(first.get().values).toEqual(["healthy"])
    expect(failures).toHaveLength(1)
  }),
)

it.effect("restarts an outer candidate when a nested read quarantines one of its contributors", () =>
  Effect.gen(function* () {
    let fail = false
    const owned = State.owner(() => {})
    const inner = State.create({ initial: () => ({ value: 0 }), editor: (value) => value })
    const outer = State.create({ initial: () => ({ value: 0 }), editor: (value) => value })
    yield* outer.transform((editor) => (editor.value += 10)).pipe(owned)
    yield* inner
      .transform((editor) => {
        editor.value = 5
        if (fail) throw new Error("inner failed")
      })
      .pipe(owned)
    yield* outer.transform((editor) => (editor.value += inner.get().value + 1))
    expect(outer.get().value).toBe(16)

    fail = true
    yield* State.batch(
      Effect.gen(function* () {
        yield* inner.reload()
        yield* outer.reload()
        expect(outer.get().value).toBe(1)
        expect(inner.get().value).toBe(0)
      }),
    )
  }),
)

it.effect("quarantines multiple failing owners once each before publishing a complete fold", () =>
  Effect.gen(function* () {
    const reported: string[] = []
    const first = State.owner(() => reported.push("first"))
    const second = State.owner(() => reported.push("second"))
    const state = State.create({ initial: () => ({ values: [] as string[] }), editor: (value) => value })
    yield* State.batch(
      Effect.gen(function* () {
        yield* state
          .transform((editor) => {
            editor.values.push("first")
            throw "first failed"
          })
          .pipe(first)
        yield* state
          .transform((editor) => {
            editor.values.push("second")
            throw { message: "second failed" }
          })
          .pipe(second)
        yield* state.transform((editor) => editor.values.push("healthy"))
      }),
    )
    expect(state.get().values).toEqual(["healthy"])
    expect(reported).toEqual(["first", "second"])
    yield* state.reload()
    expect(reported).toEqual(["first", "second"])
  }),
)

it.effect("does not quarantine an owner for a notification failure after successful replay", () =>
  Effect.gen(function* () {
    let reported = 0
    let fail = true
    const owned = State.owner(() => reported++)
    const state = State.create({
      initial: () => ({ value: 0 }),
      editor: (value) => value,
      notify: () => (fail ? Effect.die("observer failed") : Effect.void),
    })
    yield* state.transform((editor) => editor.value++).pipe(owned, Effect.exit)
    expect(reported).toBe(0)
    expect(state.get().value).toBe(1)
    fail = false
    yield* state.reload()
    expect(state.get().value).toBe(1)
  }),
)
