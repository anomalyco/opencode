import { test, expect } from "bun:test"
import { AgentDisplay } from "../../src/agent/display"

test("displayName strips leading U+200B", () => {
  const result = AgentDisplay.displayName("\u200Bprometheus")
  expect(result).toBe("prometheus")
})

test("displayName strips leading U+200C", () => {
  const result = AgentDisplay.displayName("\u200Cprometheus")
  expect(result).toBe("prometheus")
})

test("displayName strips leading U+200D", () => {
  const result = AgentDisplay.displayName("\u200Dprometheus")
  expect(result).toBe("prometheus")
})

test("displayName strips leading U+FEFF", () => {
  const result = AgentDisplay.displayName("\uFEFFprometheus")
  expect(result).toBe("prometheus")
})

test("displayName strips multiple leading invisible chars", () => {
  const result = AgentDisplay.displayName("\u200B\u200Cprometheus")
  expect(result).toBe("prometheus")
})

test("displayName preserves internal ZWJ (U+200D)", () => {
  const result = AgentDisplay.displayName("dev\u200Dops")
  expect(result).toBe("dev\u200Dops")
})

test("displayName returns raw name if stripping would make it empty", () => {
  const result = AgentDisplay.displayName("\u200B\u200C")
  expect(result).toBe("\u200B\u200C")
})

test("mention adds @ prefix to displayName", () => {
  const result = AgentDisplay.mention("\u200Bprometheus")
  expect(result).toBe("@prometheus")
})

test("title titlecases displayName", () => {
  const result = AgentDisplay.title("\u200Bprometheus")
  expect(result).toBe("Prometheus")
})

test("title titlecases displayName with hyphenated names", () => {
  const result = AgentDisplay.title("\u200Bprometheus-agent")
  expect(result).toBe("Prometheus-Agent")
})

test("title preserves internal ZWJ while titlecasing", () => {
  const result = AgentDisplay.title("dev\u200Dops")
  expect(result).toBe("Dev\u200DOps")
})
