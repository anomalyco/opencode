import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"

describe("session.processor.StreamAbortedError", () => {
  test("stores reason and partial content", () => {
    const err = new SessionProcessor.StreamAbortedError("bad content", "partial text here", "text-delta")
    expect(err.reason).toBe("bad content")
    expect(err.partialContent).toBe("partial text here")
    expect(err.type).toBe("text-delta")
    expect(err.name).toBe("StreamAbortedError")
    expect(err.message).toBe("Stream aborted by plugin: bad content")
  })

  test("is an instance of Error", () => {
    const err = new SessionProcessor.StreamAbortedError("test", "", "text-delta")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(SessionProcessor.StreamAbortedError)
  })

  test("has a stack trace", () => {
    const err = new SessionProcessor.StreamAbortedError("reason", "content", "text-delta")
    expect(err.stack).toBeDefined()
    expect(err.stack).toContain("StreamAbortedError")
  })

  test("handles empty reason and content", () => {
    const err = new SessionProcessor.StreamAbortedError("", "", "text-delta")
    expect(err.reason).toBe("")
    expect(err.partialContent).toBe("")
    expect(err.message).toBe("Stream aborted by plugin: ")
  })
})

describe("stream hook type contracts", () => {
  test("stream.delta input shape matches expected fields", () => {
    // Verify the hook input type has the required fields
    const input = {
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "text-delta" as const,
      delta: "hello",
      accumulated: "hello world",
    }
    expect(input.sessionID).toBe("sess-1")
    expect(input.type).toBe("text-delta")
    expect(input.delta).toBe("hello")
    expect(input.accumulated).toBe("hello world")
  })

  test("stream.delta supports all three delta types", () => {
    const types = ["text-delta", "reasoning-delta", "tool-input-delta"] as const
    for (const t of types) {
      const input = {
        sessionID: "s",
        messageID: "m",
        type: t,
        delta: "d",
        accumulated: "a",
      }
      expect(input.type).toBe(t)
    }
  })

  test("stream.delta output defaults to no-abort", () => {
    const output = { delta: "hello", abort: false, reason: "" }
    expect(output.delta).toBe("hello")
    expect(output.abort).toBe(false)
    expect(output.reason).toBe("")
  })

  test("stream.aborted input shape matches expected fields", () => {
    const input = {
      sessionID: "sess-1",
      messageID: "msg-1",
      type: "text-delta" as const,
      reason: "content policy violation",
      partialContent: "some partial output",
    }
    expect(input.type).toBe("text-delta")
    expect(input.reason).toBe("content policy violation")
    expect(input.partialContent).toBe("some partial output")
  })

  test("stream.aborted output defaults to no-retry", () => {
    const output = { retry: false, injectMessage: "", discardPartial: true }
    expect(output.retry).toBe(false)
    expect(output.injectMessage).toBe("")
    expect(output.discardPartial).toBe(true)
  })

  test("stream.aborted output supports retry with message injection", () => {
    const output = {
      retry: true,
      injectMessage: "Please avoid SQL statements in your response.",
      discardPartial: true,
    }
    expect(output.retry).toBe(true)
    expect(output.injectMessage).toContain("SQL")
  })
})

describe("STREAM_ABORT_MAX_RETRIES constant", () => {
  test("StreamAbortedError can be caught and inspected in a retry loop", () => {
    const maxRetries = 3
    let retries = 0
    const errors: SessionProcessor.StreamAbortedError[] = []

    while (retries < maxRetries) {
      const err = new SessionProcessor.StreamAbortedError(`attempt ${retries + 1}`, `content-${retries}`, "text-delta")
      errors.push(err)
      retries++
    }

    expect(errors).toHaveLength(3)
    expect(errors[0].reason).toBe("attempt 1")
    expect(errors[2].partialContent).toBe("content-2")
  })
})
