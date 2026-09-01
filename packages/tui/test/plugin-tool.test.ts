import { expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode-ai/client"
import type { ToolPresenter } from "@opencode-ai/plugin/tui/context"
import { guardToolPresenter } from "../src/plugin/api"
import { combineToolPresenters } from "../src/plugin/context"

test("resolves tool presenters by exact name", () => {
  const presenter: ToolPresenter = () => ({ summary: "Renamed session" })
  const combined = combineToolPresenters([["session-tools", { rename_session: presenter }]])

  expect(combined.get("rename_session")).toEqual({ plugin: "session-tools", presenter })
  expect(combined.get("Rename_Session")).toBeUndefined()
})

test("later tool presenter registrations take precedence", () => {
  const first: ToolPresenter = () => ({ summary: "first" })
  const second: ToolPresenter = () => ({ summary: "second" })
  const combined = combineToolPresenters([
    ["first-plugin", { rename_session: first }],
    ["second-plugin", { rename_session: second }],
  ])

  expect(combined.get("rename_session")).toEqual({ plugin: "second-plugin", presenter: second })
})

test("disables a throwing presenter for its activation", () => {
  const part = {
    type: "tool",
    id: "call_1",
    name: "rename_session",
    state: { status: "running", input: {}, metadata: {} },
    time: { created: 1 },
  } satisfies SessionMessageAssistantTool
  const errors: unknown[] = []
  let calls = 0
  const presenter = guardToolPresenter(
    () => {
      calls++
      throw new Error("boom")
    },
    (error) => errors.push(error),
  )

  expect(presenter(part)).toBeUndefined()
  expect(presenter(part)).toBeUndefined()
  expect(calls).toBe(1)
  expect(errors).toHaveLength(1)
})
