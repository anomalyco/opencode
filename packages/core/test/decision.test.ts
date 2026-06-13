import { test, expect } from "bun:test"
import { Decision } from "../src/decision"

test("decision.recorded event is defined", () => {
  expect(Decision.Recorded.type).toBe("decision.recorded")
  expect(typeof Decision.record).toBe("function")
})
