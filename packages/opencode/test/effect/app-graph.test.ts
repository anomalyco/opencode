import { describe, expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const { buildLayer: build, group, replace, replaceWithNode } = LayerNode
const node = LayerNode.make

class Value extends Context.Service<Value, { readonly value: string }>()("test/Value") {}
class Greeting extends Context.Service<Greeting, { readonly text: string }>()("test/Greeting") {}

const value = LayerNode.make(Layer.succeed(Value, Value.of({ value: "production" })), [])
const greetingImplementation = Layer.effect(
  Greeting,
  Effect.gen(function* () {
    return Greeting.of({ text: `hello ${(yield* Value).value}` })
  }),
)
const greeting = LayerNode.make(greetingImplementation, [value])

// @ts-expect-error Greeting requires Value
LayerNode.make(greetingImplementation, [])

describe("app graph", () => {
  test("creates any selected dependency layer", async () => {
    const result = Effect.gen(function* () {
      return (yield* Greeting).text
    }).pipe(Effect.provide(build(greeting)))

    expect(await Effect.runPromise(result)).toBe("hello production")
  })

  test("applies overrides before dependency materialization", async () => {
    const replacement = Layer.succeed(Value, Value.of({ value: "simulation" }))
    const graph = build(greeting, { replacements: [replace(value, replacement)] })
    const result = Effect.gen(function* () {
      return (yield* Greeting).text
    }).pipe(Effect.provide(graph))

    expect(await Effect.runPromise(result)).toBe("hello simulation")
  })

  test("acquires a shared dependency once", async () => {
    class Shared extends Context.Service<Shared, { readonly value: string }>()("test/Shared") {}
    class Left extends Context.Service<Left, { readonly value: string }>()("test/Left") {}
    class Right extends Context.Service<Right, { readonly value: string }>()("test/Right") {}
    let acquisitions = 0
    const shared = node(
      Layer.effect(
        Shared,
        Effect.sync(() => {
          acquisitions++
          return Shared.of({ value: "shared" })
        }),
      ),
      [],
    )
    const left = node(
      Layer.effect(
        Left,
        Effect.gen(function* () {
          return Left.of({ value: `${(yield* Shared).value}-left` })
        }),
      ),
      [shared],
    )
    const right = node(
      Layer.effect(
        Right,
        Effect.gen(function* () {
          return Right.of({ value: `${(yield* Shared).value}-right` })
        }),
      ),
      [shared],
    )

    const result = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value]
    }).pipe(Effect.provide(build(group([left, right]))))

    expect(await Effect.runPromise(result)).toEqual(["shared-left", "shared-right"])
    expect(acquisitions).toBe(1)
  })

  test("applies a replacement to every transitive consumer", async () => {
    class Left extends Context.Service<Left, { readonly value: string }>()("test/ReplacementLeft") {}
    class Right extends Context.Service<Right, { readonly value: string }>()("test/ReplacementRight") {}
    const left = node(
      Layer.effect(
        Left,
        Effect.gen(function* () {
          return Left.of({ value: (yield* Value).value })
        }),
      ),
      [value],
    )
    const right = node(
      Layer.effect(
        Right,
        Effect.gen(function* () {
          return Right.of({ value: (yield* Value).value })
        }),
      ),
      [value],
    )
    const replacement = Layer.succeed(Value, Value.of({ value: "simulation" }))
    const graph = build(group([left, right]), { replacements: [replace(value, replacement)] })

    const result = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value]
    }).pipe(Effect.provide(graph))

    expect(await Effect.runPromise(result)).toEqual(["simulation", "simulation"])
  })

  test("propagates layer acquisition errors", async () => {
    class AcquisitionError {
      readonly _tag = "AcquisitionError"
    }
    const failing = node(Layer.effect(Value, Effect.fail(new AcquisitionError())), [])
    const exit = await Effect.runPromiseExit(Effect.provide(Value, build(failing)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(AcquisitionError)
  })

  test("groups expose every selected service", async () => {
    class Count extends Context.Service<Count, { readonly value: number }>()("test/Count") {}
    const count = node(Layer.succeed(Count, Count.of({ value: 3 })), [])
    const result = Effect.gen(function* () {
      return { text: (yield* Value).value, count: (yield* Count).value }
    }).pipe(Effect.provide(build(group([value, count]))))

    expect(await Effect.runPromise(result)).toEqual({ text: "production", count: 3 })
  })

  test("builds an empty group", async () => {
    expect(await Effect.runPromise(Effect.succeed("ok").pipe(Effect.provide(build(group([])))))).toBe("ok")
  })

  test("builds replacements with their own dependencies", async () => {
    class ReplacementConfig extends Context.Service<ReplacementConfig, { readonly value: string }>()(
      "test/ReplacementConfig",
    ) {}
    const replacementConfig = node(Layer.succeed(ReplacementConfig, ReplacementConfig.of({ value: "replacement" })), [])
    const replacement = node(
      Layer.effect(
        Value,
        Effect.gen(function* () {
          return Value.of({ value: (yield* ReplacementConfig).value })
        }),
      ),
      [replacementConfig],
    )
    const result = Effect.gen(function* () {
      return (yield* Greeting).text
    }).pipe(Effect.provide(build(greeting, { replacements: [replaceWithNode(value, replacement)] })))

    expect(await Effect.runPromise(result)).toBe("hello replacement")
  })

  test("does not acquire unreachable replacements", async () => {
    let acquisitions = 0
    const unreachable = node(Layer.succeed(Value, Value.of({ value: "unreachable" })), [])
    const replacement = Layer.effect(
      Value,
      Effect.sync(() => {
        acquisitions++
        return Value.of({ value: "replacement" })
      }),
    )

    await Effect.runPromise(
      Effect.provide(Greeting, build(greeting, { replacements: [replace(unreachable, replacement)] })),
    )

    expect(acquisitions).toBe(0)
  })

  test("rejects a direct cycle", () => {
    const cyclic = node(Layer.succeed(Value, Value.of({ value: "cyclic" })), [])
    ;(cyclic.dependencies as LayerNode.Node<unknown, unknown>[]).push(cyclic)

    expect(() => build(cyclic)).toThrow("Cycle detected in app graph: layer#1 -> layer#1")
  })

  test("rejects an indirect cycle", () => {
    const first = node(Layer.succeed(Value, Value.of({ value: "first" })), [])
    const second = node(Layer.succeed(Value, Value.of({ value: "second" })), [first])
    const third = node(Layer.succeed(Value, Value.of({ value: "third" })), [second])
    ;(first.dependencies as LayerNode.Node<unknown, unknown>[]).push(third)

    expect(() => build(first)).toThrow("Cycle detected in app graph: layer#1 -> layer#2 -> layer#3 -> layer#1")
  })

  test("rejects a cycle introduced by a replacement", () => {
    const replacement = node(Layer.succeed(Value, Value.of({ value: "replacement" })), [])
    const consumer = node(greetingImplementation, [value])
    ;(replacement.dependencies as LayerNode.Node<unknown, unknown>[]).push(consumer)

    expect(() => build(consumer, { replacements: [replaceWithNode(value, replacement)] })).toThrow(
      "Cycle detected in app graph: layer#1 -> layer#2 -> layer#1",
    )
  })
})
