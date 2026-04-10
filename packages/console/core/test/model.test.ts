import { expect, mock, test } from "bun:test"

const data = JSON.stringify({
  models: {
    "qwen3.6-plus-free": {
      name: "Qwen3.6 Plus Free",
      cost: { input: 0, output: 0 },
      providers: [],
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 1, output: 1 },
    },
    "safe-model": {
      name: "Safe Model",
      cost: { input: 0, output: 0 },
      providers: [],
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 1, output: 1 },
    },
  },
  liteModels: {
    "qwen3.6-plus-free": {
      name: "Qwen3.6 Plus Free",
      cost: { input: 0, output: 0 },
      providers: [],
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 1, output: 1 },
    },
    "safe-lite": {
      name: "Safe Lite",
      cost: { input: 0, output: 0 },
      providers: [],
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 1, output: 1 },
    },
  },
  providers: {},
})

const n = Math.ceil(data.length / 30)
const res = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [`ZEN_MODELS${i + 1}`, { value: data.slice(n * i, i === 29 ? undefined : n * (i + 1)) }]),
)

mock.module("@opencode-ai/console-resource", () => ({
  Resource: res,
}))

const { ZenData } = await import("../src/model")

test("zen data filters deprecated models from the full list", () => {
  const zen = ZenData.list("full")

  expect(Object.keys(zen.models)).not.toContain("qwen3.6-plus-free")
  expect(Object.keys(zen.models)).toContain("safe-model")
})

test("zen data filters deprecated models from the lite list", () => {
  const zen = ZenData.list("lite")

  expect(Object.keys(zen.models)).not.toContain("qwen3.6-plus-free")
  expect(Object.keys(zen.models)).toContain("safe-lite")
})
