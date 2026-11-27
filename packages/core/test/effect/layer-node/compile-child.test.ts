import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../../lib/effect"

class Value extends Context.Service<Value, { readonly value: string }>()("test/ChildValue") {}
class Other extends Context.Service<Other, { readonly value: string }>()("test/ChildOther") {}
class Local extends Context.Service<Local, { readonly value: string }>()("test/ChildLocal") {}

const it = testEffect(Layer.empty)
const tags = LayerNode.tags({ location: ["global"], global: [] })
const global = tags.make("global")
const location = tags.make("location")
const shared = tags.values.global

function counted() {
  const acquired = { value: 0, other: 0, local: 0 }
  const value = global({
    service: Value,
    layer: Layer.effect(
      Value,
      Effect.sync(() => Value.of({ value: `value-${++acquired.value}` })),
    ),
    deps: [],
  })
  const other = global({
    service: Other,
    layer: Layer.effect(
      Other,
      Effect.map(Value, (value) => Other.of({ value: `other-${++acquired.other} of ${value.value}` })),
    ),
    deps: [value],
  })
  const local = location({
    service: Local,
    layer: Layer.effect(
      Local,
      Effect.gen(function* () {
        const value = yield* Value
        return Local.of({ value: `local-${++acquired.local} of ${value.value}` })
      }),
    ),
    deps: [value],
  })
  return { acquired, value, other, local }
}

describe("LayerNode.tagged", () => {
  test("collects every reachable tagged node including transitive dependencies, after replacements", () => {
    const graph = counted()
    const replacement = location({
      service: Local,
      layer: Layer.effect(
        Local,
        Effect.map(Other, (other) => Local.of({ value: other.value })),
      ),
      deps: [graph.other],
    })
    expect(LayerNode.tagged(LayerNode.group([graph.local]), shared).map((node) => node.name)).toEqual([
      "test/ChildValue",
    ])
    // Other depends on Value, so both are exposed in hostContext for any child replacement that needs Value directly.
    expect(
      LayerNode.tagged(LayerNode.group([graph.local, LayerNode.group([graph.local])]), shared, [
        graph.local.replace(replacement),
      ]).map((node) => node.name),
    ).toEqual(["test/ChildOther", "test/ChildValue"])
  })
})

describe("LayerNode.compileChild", () => {
  it.effect("reads globals from the host context and builds locals fresh for every child", () =>
    Effect.gen(function* () {
      const graph = counted()
      const context = yield* Layer.build(LayerNode.compile(LayerNode.group([graph.value])))
      expect(graph.acquired).toEqual({ value: 1, other: 0, local: 0 })
      const child = LayerNode.compileChild(LayerNode.group([graph.local, graph.value]), {
        host: { tag: shared, context },
      })

      const first = yield* Layer.build(child)
      const second = yield* Layer.build(child)
      expect(Context.get(first, Value)).toBe(Context.get(context, Value))
      expect(Context.get(first, Local).value).toBe("local-1 of value-1")
      expect(Context.get(second, Local).value).toBe("local-2 of value-1")
      expect(graph.acquired).toEqual({ value: 1, other: 0, local: 2 })
    }),
  )

  it.effect("exposes transitive globals built on the host to child-only replacements", () =>
    Effect.gen(function* () {
      const graph = counted()
      const localViaOther = location({
        service: Local,
        layer: Layer.effect(
          Local,
          Effect.map(Other, (other) => Local.of({ value: other.value })),
        ),
        deps: [graph.other],
      })
      const context = yield* Layer.build(LayerNode.compile(LayerNode.group(LayerNode.tagged(localViaOther, shared))))
      const child = yield* Layer.build(
        LayerNode.compileChild(localViaOther, {
          host: { tag: shared, context },
          replacements: [localViaOther.replace(graph.local)],
        }),
      )
      expect(Context.get(child, Local).value).toBe("local-1 of value-1")
      expect(graph.acquired).toEqual({ value: 1, other: 1, local: 1 })
    }),
  )

  test("fails loudly when the host context lacks a global the child reaches", () => {
    const graph = counted()
    expect(() => LayerNode.compileChild(graph.local, { host: { tag: shared, context: Context.empty() } })).toThrow(
      "Host context is missing test/ChildValue",
    )
  })

  test("rejects a child replacement of a global node", () => {
    const graph = counted()
    expect(() =>
      LayerNode.compileChild(graph.local, {
        host: { tag: shared, context: Context.empty() },
        replacements: [graph.value.replace(Layer.succeed(Value, Value.of({ value: "child" })))],
      }),
    ).toThrow("Cannot replace test/ChildValue in a child graph")
  })

  it.effect("applies the host's local replacements and skips the global ones it already built", () =>
    Effect.gen(function* () {
      const graph = counted()
      const inherited = [
        graph.value.replace(Layer.succeed(Value, Value.of({ value: "host" }))),
        graph.local.replace(
          location({
            service: Local,
            layer: Layer.effect(
              Local,
              Effect.map(Value, (value) => Local.of({ value: `replaced of ${value.value}` })),
            ),
            deps: [graph.value],
          }),
        ),
      ]
      const context = yield* Layer.build(LayerNode.compile(graph.value, { replacements: inherited }))
      const child = yield* Layer.build(
        LayerNode.compileChild(graph.local, { host: { tag: shared, context, replacements: inherited } }),
      )
      expect(Context.get(child, Local).value).toBe("replaced of host")
      expect(graph.acquired).toEqual({ value: 0, other: 0, local: 0 })
    }),
  )
})
