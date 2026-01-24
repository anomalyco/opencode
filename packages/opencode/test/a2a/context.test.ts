import { describe, expect, test, beforeEach } from "bun:test"
import {
  getContextId,
  setContextId,
  clearContextId,
  clearAllContexts,
} from "../../src/a2a/context"

describe("a2a.context", () => {
  beforeEach(() => {
    clearAllContexts()
  })

  test("stores contextId by session+domain", () => {
    setContextId("session-1", "example.com", "ctx-123")

    const result = getContextId("session-1", "example.com")
    expect(result).toBe("ctx-123")
  })

  test("retrieves stored contextId", () => {
    setContextId("session-1", "example.com", "ctx-123")
    setContextId("session-1", "other.com", "ctx-456")
    setContextId("session-2", "example.com", "ctx-789")

    expect(getContextId("session-1", "example.com")).toBe("ctx-123")
    expect(getContextId("session-1", "other.com")).toBe("ctx-456")
    expect(getContextId("session-2", "example.com")).toBe("ctx-789")
  })

  test("returns undefined for unknown session+domain", () => {
    expect(getContextId("unknown", "example.com")).toBeUndefined()
  })

  test("overwrites existing contextId", () => {
    setContextId("session-1", "example.com", "ctx-123")
    setContextId("session-1", "example.com", "ctx-456")

    expect(getContextId("session-1", "example.com")).toBe("ctx-456")
  })

  test("clears specific context", () => {
    setContextId("session-1", "example.com", "ctx-123")
    setContextId("session-1", "other.com", "ctx-456")

    clearContextId("session-1", "example.com")

    expect(getContextId("session-1", "example.com")).toBeUndefined()
    expect(getContextId("session-1", "other.com")).toBe("ctx-456")
  })

  test("clears all contexts", () => {
    setContextId("session-1", "example.com", "ctx-123")
    setContextId("session-2", "other.com", "ctx-456")

    clearAllContexts()

    expect(getContextId("session-1", "example.com")).toBeUndefined()
    expect(getContextId("session-2", "other.com")).toBeUndefined()
  })

  test("handles domains with ports", () => {
    setContextId("session-1", "localhost:3000", "ctx-123")

    expect(getContextId("session-1", "localhost:3000")).toBe("ctx-123")
    expect(getContextId("session-1", "localhost")).toBeUndefined()
  })
})
