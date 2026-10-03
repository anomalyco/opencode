import { describe, expect, test } from "bun:test"
import { Context, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class Value extends Context.Service<Value, { readonly value: string }>()("test/LayerNodeValidationValue") {}

const valueLayer = Layer.succeed(Value, Value.of({ value: "value" }))

describe("layer node validation", () => {
  test("make rejects undefined dependencies and names the owner node", () => {
    expect(() => LayerNode.make({ service: Value, layer: valueLayer, deps: [undefined as never] })).toThrow(
      "LayerNode test/LayerNodeValidationValue: invalid dependency at index 0 (undefined)",
    )
  })

  test("group rejects undefined items and reports the index", () => {
    expect(() => LayerNode.group([undefined as never])).toThrow(
      "LayerNode group: invalid dependency at index 0 (undefined)",
    )
  })
})
