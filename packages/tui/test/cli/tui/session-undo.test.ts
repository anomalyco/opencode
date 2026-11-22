import { expect, test } from "bun:test"
import type { SessionMessageUser } from "@opencode/client"
import { findUndoMessage } from "../../../src/routes/session/undo"

const user = (id: string, text: string): SessionMessageUser => ({
  id,
  text,
  time: { created: 0 },
  type: "user",
})

test("skips admitted messages that have not been promoted", () => {
  const promoted = user("promoted", "previous")
  const admitted = user("admitted", "latest")

  expect(findUndoMessage([promoted, admitted], new Set([admitted.id]), new Set())).toBe(promoted)
})

test("keeps a pending message undoable so it can be cancelled", () => {
  const pending = user("pending", "latest")

  expect(findUndoMessage([pending], new Set([pending.id]), new Set([pending.id]))).toBe(pending)
})
