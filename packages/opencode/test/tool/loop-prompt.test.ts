import { describe, expect, it } from "bun:test"
import PROMPT_LOOP from "../../src/agent/prompt/loop.txt"

const registeredLoopTools = [
  "loop_plan_create",
  "loop_phase_define",
  "loop_verify_quality",
  "loop_summary",
  "loop_complete",
]

describe("loop prompt validation", () => {
  for (const id of registeredLoopTools) {
    it(`prompt mentions ${id}`, () => {
      expect(PROMPT_LOOP).toContain(id)
    })
  }
})
