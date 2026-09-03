import { describe, expect, test } from "bun:test"
import { Context, Deferred, Duration, Effect, Fiber, Layer, LayerMap, Option } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "../../lib/effect"

class Value extends Context.Service<Value, { readonly value: string }>()("test/LayerNodeValue") {}
class Greeting extends Context.Service<Greeting, { readonly value: string }>()("test/LayerNodeGreeting") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/LayerNodeLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/LayerNodeRight") {}
class Memo extends Context.Service<Memo, Layer.MemoMap>()("test/LayerNodeMemo") {}
class Support extends Context.Service<Support, {}>()("test/LayerNodeSupport") {}
class Locations extends Context.Service<Locations, LayerMap.LayerMap<string, Value | Right, "failed location">>()(
  "test/LayerNodeLocations",
) {}

const it = testEffect(Layer.empty)
const tags = LayerNode.tags({ app: [] })
const make = tags.make("app")
const valueLayer = Layer.succeed(Value, Value.of({ value: "production" }))
const greetingLayer = Layer.effect(
  Greeting,
  Effect.map(Value, (value) => Greeting.of({ value: `hello ${value.value}` })),
)
const value = make({ service: Value, layer: valueLayer, deps: [] })
const greeting = make({ service: Greeting, layer: greetingLayer, deps: [value] })

describe("layer node", () => {
  it.effect("builds an untagged graph", () =>
    Effect.gen(function* () {
      const value = LayerNode.make({ service: Value, layer: valueLayer, deps: [] })
      const greeting = LayerNode.make({ service: Greeting, layer: greetingLayer, deps: [value] })
      const result = yield* Greeting.pipe(Effect.provide(LayerNode.compile(LayerNode.group([greeting]))))
      expect(result.value).toBe("hello production")
    }),
  )

  it.effect("exposes roots but hides transitive dependencies", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(LayerNode.compile(LayerNode.group([greeting])))
      expect(Context.get(context, Greeting).value).toBe("hello production")
      expect(Option.isNone(Context.getOption(context, Value))).toBe(true)
    }),
  )

  it.effect("replaces exact declarations, not sibling names or native layer identities", () =>
    Effect.gen(function* () {
      const sibling = make({ service: Value, layer: valueLayer, deps: [] })
      const target = make({ name: "different-name", layer: Layer.succeed(Value, { value: "replaced" }), deps: [] })
      const left = make({
        service: Left,
        layer: Layer.effect(
          Left,
          Effect.map(Value, (item) => Left.of({ value: item.value })),
        ),
        deps: [value],
      })
      const right = make({
        service: Right,
        layer: Layer.effect(
          Right,
          Effect.map(Value, (item) => Right.of({ value: item.value })),
        ),
        deps: [sibling],
      })
      const context = yield* Layer.build(
        LayerNode.compile(LayerNode.group([left, right]), { replacements: [value.replace(target)] }),
      )
      expect(Context.get(context, Left).value).toBe("replaced")
      expect(Context.get(context, Right).value).toBe("production")
    }),
  )

  it.effect("requires reachable unbound nodes to be replaced", () =>
    Effect.gen(function* () {
      const unbound = LayerNode.unbound(Value, tags.values.app)
      const root = make({ service: Greeting, layer: greetingLayer, deps: [unbound] })
      expect(() => LayerNode.compile(root)).toThrow("Unbound layer node: test/LayerNodeValue")
      const result = yield* Greeting.pipe(
        Effect.provide(LayerNode.compile(root, { replacements: [unbound.replace(value)] })),
      )
      expect(result.value).toBe("hello production")
    }),
  )

  it.effect("replaces every use of a declaration with a stored closed-layer replacement", () =>
    Effect.gen(function* () {
      const replacements: LayerNode.Replacements = [value.replace(Layer.succeed(Value, { value: "replacement" }))]
      const right = make({
        service: Right,
        layer: Layer.effect(
          Right,
          Effect.map(Value, (item) => Right.of({ value: item.value })),
        ),
        deps: [value],
      })
      const context = yield* Layer.build(LayerNode.compile(LayerNode.group([greeting, right]), { replacements }))
      expect(Context.get(context, Greeting).value).toBe("hello replacement")
      expect(Context.get(context, Right).value).toBe("replacement")
    }),
  )

  it.effect("uses the last replacement and ignores unreachable unbound defaults and cycles", () =>
    Effect.gen(function* () {
      const unbound = LayerNode.unbound(Value, tags.values.app)
      const unused = make({ service: Value, layer: valueLayer, deps: [] })
      const result = yield* Greeting.pipe(
        Effect.provide(
          LayerNode.compile(greeting, {
            replacements: [
              value.replace(unbound),
              unbound.replace(unused),
              unused.replace(unbound),
              value.replace(Layer.succeed(Value, { value: "last" })),
            ],
          }),
        ),
      )
      expect(result.value).toBe("hello last")
    }),
  )

  it.effect("resolves target chains independently of replacement order and treats self-replacement as identity", () =>
    Effect.gen(function* () {
      const middle = make({ service: Value, layer: Layer.succeed(Value, { value: "middle" }), deps: [] })
      const target = make({ service: Value, layer: Layer.succeed(Value, { value: "target" }), deps: [] })
      const result = yield* Greeting.pipe(
        Effect.provide(
          LayerNode.compile(greeting, {
            replacements: [target.replace(target), middle.replace(target), value.replace(middle)],
          }),
        ),
      )
      expect(result.value).toBe("hello target")
    }),
  )

  test("rejects reachable replacement and dependency cycles", () => {
    const other = make({ service: Value, layer: valueLayer, deps: [] })
    expect(() => LayerNode.compile(greeting, { replacements: [value.replace(other), other.replace(value)] })).toThrow(
      "Cycle detected in layer graph",
    )
    const dependent = make({
      service: Value,
      layer: Layer.effect(
        Value,
        Effect.map(Greeting, (item) => Value.of({ value: item.value })),
      ),
      deps: [greeting],
    })
    expect(() => LayerNode.compile(greeting, { replacements: [value.replace(dependent)] })).toThrow(
      "Cycle detected in layer graph",
    )
  })

  it.effect("does not acquire replaced dependencies or unused replacement targets", () =>
    Effect.gen(function* () {
      const acquired: string[] = []
      const dependency = make({
        service: Value,
        layer: Layer.effect(
          Value,
          Effect.sync(() => {
            acquired.push("old dependency")
            return Value.of({ value: "dependency" })
          }),
        ),
        deps: [],
      })
      const original = make({ service: Greeting, layer: greetingLayer, deps: [dependency] })
      const result = yield* Greeting.pipe(
        Effect.provide(
          LayerNode.compile(original, {
            replacements: [
              original.replace(Layer.succeed(Greeting, { value: "replacement" })),
              value.replace(
                Layer.effect(
                  Value,
                  Effect.sync(() => {
                    acquired.push("unused target")
                    return Value.of({ value: "unused" })
                  }),
                ),
              ),
            ],
          }),
        ),
      )
      expect(result.value).toBe("replacement")
      expect(acquired).toEqual([])
    }),
  )

  it.effect("mapLayer preserves dependency wiring and replacement traversal", () =>
    Effect.gen(function* () {
      const acquired: string[] = []
      const decorated = greeting.mapLayer((layer) =>
        layer.pipe(
          Layer.tap((context) =>
            Effect.sync(() => {
              acquired.push(Context.get(context, Greeting).value)
            }),
          ),
        ),
      )
      const result = yield* Greeting.pipe(
        Effect.provide(
          LayerNode.compile(greeting, {
            replacements: [
              greeting.replace(decorated),
              value.replace(Layer.succeed(Value, { value: "mapped dependency" })),
            ],
          }),
        ),
      )
      expect(result.value).toBe("hello mapped dependency")
      expect(acquired).toEqual(["hello mapped dependency"])
    }),
  )

  it.effect("memoizes shared wiring instead of expanding a diamond into a tree", () =>
    Effect.gen(function* () {
      const acquisitions: string[] = []
      const shared = value.mapLayer((layer) =>
        layer.pipe(Layer.tap(() => Effect.sync(() => acquisitions.push("shared")))),
      )
      const left = make({ name: "left", layer: Layer.empty, deps: [shared] })
      const right = make({ name: "right", layer: Layer.empty, deps: [shared] })
      yield* Layer.build(LayerNode.compile(LayerNode.group([left, right])))
      expect(acquisitions).toEqual(["shared"])
    }),
  )

  it.effect("preserves declared memo-service outputs rather than filtering them as build metadata", () =>
    Effect.gen(function* () {
      const supplied = yield* Layer.makeMemoMap
      const memo = make({
        service: Layer.CurrentMemoMap,
        layer: Layer.succeed(Layer.CurrentMemoMap, supplied),
        deps: [],
      })
      const observer = make({ service: Memo, layer: Layer.effect(Memo, Layer.CurrentMemoMap), deps: [memo] })
      expect(yield* Memo.pipe(Effect.provide(LayerNode.compile(observer)))).toBe(supplied)
    }),
  )

  it.effect("rejects one implementation wired to different effective dependencies in either memo domain", () =>
    Effect.gen(function* () {
      const other = make({ service: Value, layer: Layer.succeed(Value, { value: "other" }), deps: [] })
      const sibling = make({ service: Greeting, layer: greetingLayer, deps: [other] })
      const root = LayerNode.group([greeting, sibling])
      expect(() => LayerNode.compile(root)).toThrow("wired to different dependencies")
      expect(() => LayerNode.compile(root, { shared: tags.values.app })).toThrow("wired to different dependencies")
      const result = yield* Greeting.pipe(
        Effect.provide(LayerNode.compile(root, { replacements: [value.replace(other)] })),
      )
      expect(result.value).toBe("hello other")
    }),
  )

  it.effect("starts dependencies in parallel and nested group roots in order", () =>
    Effect.gen(function* () {
      const valueStarted = yield* Deferred.make<void>()
      const greetingStarted = yield* Deferred.make<void>()
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const events: string[] = []
      const value = make({
        service: Value,
        layer: Layer.effect(
          Value,
          Effect.gen(function* () {
            yield* Deferred.succeed(valueStarted, undefined)
            yield* Deferred.await(greetingStarted)
            return Value.of({ value: "value" })
          }),
        ),
        deps: [],
      })
      const greeting = make({
        service: Greeting,
        layer: Layer.effect(
          Greeting,
          Effect.gen(function* () {
            yield* Deferred.succeed(greetingStarted, undefined)
            yield* Deferred.await(valueStarted)
            return Greeting.of({ value: "greeting" })
          }),
        ),
        deps: [],
      })
      const first = make({
        service: Left,
        layer: Layer.effect(
          Left,
          Effect.gen(function* () {
            yield* Value
            yield* Greeting
            events.push("first started")
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
            events.push("first finished")
            return Left.of({ value: "first" })
          }),
        ),
        deps: [value, greeting],
      })
      const second = make({
        service: Right,
        layer: Layer.effect(
          Right,
          Effect.sync(() => {
            expect(events).toEqual(["first started", "first finished"])
            events.push("second started")
            return Right.of({ value: "second" })
          }),
        ),
        deps: [],
      })
      const fiber = yield* Layer.build(LayerNode.compile(LayerNode.group([LayerNode.group([first]), second]))).pipe(
        Effect.forkChild,
      )
      yield* Deferred.await(firstStarted)
      expect(events).toEqual(["first started"])
      yield* Deferred.succeed(releaseFirst, undefined)
      const context = yield* Fiber.join(fiber)
      expect(events).toEqual(["first started", "first finished", "second started"])
      expect(Context.get(context, Left).value).toBe("first")
      expect(Context.get(context, Right).value).toBe("second")
    }),
  )
  ;[false, true].forEach((topLevel) => {
    it.effect(
      `LayerMap isolates builds and retains resources ${topLevel ? "with" : "without"} a top-level global owner`,
      () =>
        Effect.gen(function* () {
          const acquired = { global: 0, local: 0, support: 0 }
          const released: string[] = []
          const startup: string[] = []
          yield* Effect.gen(function* () {
            const memoMap = yield* Layer.makeMemoMap
            const tags = LayerNode.tags({ location: ["global"], global: [] })
            const global = tags.make("global")
            const location = tags.make("location")
            const support = LayerNode.make({
              service: Support,
              layer: Layer.effect(
                Support,
                Effect.acquireRelease(
                  Effect.sync(() => {
                    acquired.support++
                    return Support.of({})
                  }),
                  () =>
                    Effect.sync(() => {
                      released.push("support")
                    }),
                ),
              ),
              deps: [],
            })
            const value = global({
              service: Value,
              layer: Layer.effect(
                Value,
                Effect.andThen(
                  Support,
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      startup.push("global")
                      return Value.of({ value: `global-${++acquired.global}` })
                    }),
                    (value) =>
                      Effect.sync(() => {
                        released.push(value.value)
                      }),
                  ),
                ),
              ),
              deps: [support],
            })
            const local = location({
              service: Greeting,
              layer: Layer.effect(
                Greeting,
                Effect.gen(function* () {
                  yield* Value
                  return yield* Effect.acquireRelease(
                    Effect.sync(() => Greeting.of({ value: `local-${++acquired.local}` })),
                    (value) =>
                      Effect.sync(() => {
                        released.push(value.value)
                      }),
                  )
                }),
              ),
              deps: [LayerNode.group([value])],
            })
            const root = location({
              service: Right,
              layer: Layer.effect(
                Right,
                Effect.gen(function* () {
                  const local = yield* Greeting
                  if (local.value === "local-2") return yield* Effect.fail("failed location" as const)
                  return Right.of(local)
                }),
              ),
              deps: [local],
            })
            // Every key builds the same compiled Layer, not a new graph per lookup.
            const compiled = LayerNode.compile(LayerNode.group([value, root]), { shared: tags.values.global })
            const locations = location({
              service: Locations,
              layer: Layer.effect(
                Locations,
                Effect.gen(function* () {
                  startup.push("map")
                  expect(Option.getOrUndefined(yield* Effect.serviceOption(Layer.CurrentMemoMap))).toBe(memoMap)
                  return yield* LayerMap.make((_: string) => compiled, { idleTimeToLive: Duration.infinity })
                }),
              ),
              deps: [],
            })
            const scope = yield* Effect.scope
            const context = yield* Layer.buildWithMemoMap(
              LayerNode.compile(LayerNode.group([locations, ...(topLevel ? [value] : [])]), {
                shared: tags.values.global,
              }),
              memoMap,
              scope,
            )
            expect(startup).toEqual(topLevel ? ["map", "global"] : ["map"])
            const map = Context.get(context, Locations)
            const first = yield* map.contextEffect("first").pipe(Effect.scoped)
            expect(Option.getOrUndefined(Context.getOption(context, Value))).toBe(
              topLevel ? Context.get(first, Value) : undefined,
            )
            expect(Option.isNone(Context.getOption(first, Greeting))).toBe(true)
            expect(Context.get(first, Right).value).toBe("local-1")

            expect(yield* map.contextEffect("failed").pipe(Effect.scoped, Effect.flip)).toBe("failed location")
            expect(released).toEqual(["local-2"])
            expect(Context.get(yield* map.contextEffect("first").pipe(Effect.scoped), Right)).toBe(
              Context.get(first, Right),
            )

            const second = yield* map.contextEffect("second").pipe(Effect.scoped)
            expect(Context.get(second, Value)).toBe(Context.get(first, Value))
            expect(Context.get(second, Right)).not.toBe(Context.get(first, Right))
            expect(acquired).toEqual({ global: 1, local: 3, support: 1 })

            yield* map.invalidate("first")
            expect(released).toEqual(["local-2", "local-1"])
            expect(Context.get(yield* map.contextEffect("second").pipe(Effect.scoped), Right)).toBe(
              Context.get(second, Right),
            )
            const rebuilt = yield* map.contextEffect("first").pipe(Effect.scoped)
            expect(Context.get(rebuilt, Right).value).toBe("local-4")
            expect(Context.get(rebuilt, Value)).toBe(Context.get(first, Value))
            expect(acquired).toEqual({ global: 1, local: 4, support: 1 })
            expect(released).not.toContain("global-1")
          }).pipe(Effect.scoped)
          expect(released.toSorted()).toEqual(["global-1", "local-1", "local-2", "local-3", "local-4", "support"])
        }),
    )
  })
})
