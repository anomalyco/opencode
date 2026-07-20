import { expect, test } from "bun:test"
import { turnSummaryCommit } from "@/cli/cmd/run/turn-summary"

test("turn summary commit appends completion time after duration", () => {
  const commit = turnSummaryCommit({ agent: "Sisyphus - Ultraworker", model: "GPT-5.5", duration: "6.2s", time: "3:41 PM" })

  expect(commit.text).toBe("▣ Sisyphus - Ultraworker · GPT-5.5 · 6.2s · 3:41 PM")
  expect(commit.summary).toEqual({
    agent: "Sisyphus - Ultraworker",
    model: "GPT-5.5",
    duration: "6.2s",
    time: "3:41 PM",
  })
})

test("turn summary commit keeps existing text without completion time", () => {
  expect(turnSummaryCommit({ agent: "Sisyphus - Ultraworker", model: "GPT-5.5", duration: "6.2s" }).text).toBe(
    "▣ Sisyphus - Ultraworker · GPT-5.5 · 6.2s",
  )
})
