import { expect, test } from "bun:test"
import { costs } from "./cost"

test("no sub-agents", () => {
  const store = {
    message: {
      s1: [
        { id: "m1", role: "user", cost: 0 },
        { id: "m2", role: "assistant", cost: 0.5 },
      ],
    },
    part: {},
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(0.5)
  expect(result.missing).toEqual([])
})

test("one loaded sub-agent", () => {
  const store = {
    message: {
      s1: [{ id: "m1", role: "assistant", cost: 0.5 }],
      s2: [{ id: "m2", role: "assistant", cost: 1.0 }],
    },
    part: {
      m1: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s2" } } }],
    },
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(1.5)
  expect(result.missing).toEqual([])
})

test("nested sub-agents", () => {
  const store = {
    message: {
      s1: [{ id: "m1", role: "assistant", cost: 0.5 }],
      s2: [{ id: "m2", role: "assistant", cost: 1.0 }],
      s3: [{ id: "m3", role: "assistant", cost: 2.0 }],
    },
    part: {
      m1: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s2" } } }],
      m2: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s3" } } }],
    },
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(3.5)
  expect(result.missing).toEqual([])
})

test("cycle detection", () => {
  const store = {
    message: {
      s1: [{ id: "m1", role: "assistant", cost: 0.5 }],
      s2: [{ id: "m2", role: "assistant", cost: 1.0 }],
    },
    part: {
      m1: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s2" } } }],
      m2: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s1" } } }],
    },
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(1.5)
  expect(result.missing).toEqual([])
})

test("missing child session", () => {
  const store = {
    message: {
      s1: [{ id: "m1", role: "assistant", cost: 0.5 }],
    },
    part: {
      m1: [{ type: "tool", tool: "task", state: { metadata: { sessionId: "s2" } } }],
    },
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(0.5)
  expect(result.missing).toEqual(["s2"])
})

test("empty or undefined messages", () => {
  const store = {
    message: {},
    part: {},
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0)
  expect(result.total).toBe(0)
  expect(result.missing).toEqual(["s1"])
})

test("only assistant messages counted", () => {
  const store = {
    message: {
      s1: [
        { id: "m1", role: "user", cost: 100 },
        { id: "m2", role: "assistant", cost: 0.5 },
        { id: "m3", role: "system", cost: 100 },
      ],
    },
    part: {},
  }
  const result = costs("s1", store as any)
  expect(result.own).toBe(0.5)
  expect(result.total).toBe(0.5)
})
