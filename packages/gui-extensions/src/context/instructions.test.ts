import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { instructionUpdates } from "./instructions"

const freshSession = [
  { id: "msg_1", type: "user", time: { created: 1 }, text: "hello" },
  {
    id: "msg_2",
    type: "assistant",
    time: { created: 2 },
    agent: "build",
    model: { providerID: "test", id: "test" },
    content: [],
  },
  { id: "msg_3", type: "idle", time: { created: 3 }, outcome: "succeeded" },
] satisfies SessionMessageInfo[]

test("reports no instruction updates for a session that stored none", () => {
  expect(instructionUpdates(freshSession)).toEqual([])
})

test("reports a stored system message as an instruction update, with its description as provenance", () => {
  const messages = [
    ...freshSession,
    {
      id: "msg_4",
      type: "system",
      time: { created: 4 },
      text: "The instructions changed: AGENTS.md",
      description: "Instructions updated: AGENTS.md",
      metadata: { notice: "instructions", instructionSources: ["AGENTS.md"] },
    },
  ] satisfies SessionMessageInfo[]

  expect(instructionUpdates(messages)).toEqual([
    { description: "Instructions updated: AGENTS.md", text: "The instructions changed: AGENTS.md" },
  ])
})

test("ignores the restart notice, which is a synthetic message and not an update", () => {
  const messages = [
    {
      id: "msg_5",
      type: "synthetic",
      time: { created: 5 },
      text: "Continue after the server restarted.",
      description: "Continuing after restart",
      metadata: { notice: "restart" },
    },
  ] satisfies SessionMessageInfo[]

  expect(instructionUpdates(messages)).toEqual([])
})

test("drops a system message that carries no text", () => {
  const messages = [
    { id: "msg_6", type: "system", time: { created: 6 }, text: "  \n" },
  ] satisfies SessionMessageInfo[]

  expect(instructionUpdates(messages)).toEqual([])
})
