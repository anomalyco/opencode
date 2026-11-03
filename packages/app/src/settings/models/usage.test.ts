import { expect, test } from "bun:test"
import type { SessionStatsInfo } from "@opencode/client/promise"
import { usageByModel } from "./usage"

const stats = (models: SessionStatsInfo["models"]) => ({ models }) as SessionStatsInfo

test("sums generated tokens across a model's variants", () => {
  const usage = usageByModel(
    stats([
      {
        model: { providerID: "opencode", id: "big-pickle", variant: "default" },
        steps: 2,
        tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 0, write: 0 } },
        cost: 0,
      },
      {
        model: { providerID: "opencode", id: "big-pickle", variant: "high" },
        steps: 1,
        tokens: { input: 4, output: 7, reasoning: 1, cache: { read: 0, write: 0 } },
        cost: 0,
      },
    ]),
  )

  expect(usage.get("opencode:big-pickle")).toEqual({ steps: 3, generated: 16 })
})

test("keeps a model that generated nothing distinct from one that was never used", () => {
  const usage = usageByModel(
    stats([
      {
        model: { providerID: "ollama", id: "dolphin-mixtral:latest", variant: "default" },
        steps: 1,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
      },
    ]),
  )

  expect(usage.get("ollama:dolphin-mixtral:latest")).toEqual({ steps: 1, generated: 0 })
  expect(usage.get("ollama:never-used")).toBeUndefined()
})
