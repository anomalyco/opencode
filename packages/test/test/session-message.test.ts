import { expect, test } from "bun:test"
import { Expected } from "../src/session-message"

test("builds only the requested message and content fields", () => {
  expect(Expected.user("Hello")).toStrictEqual({ type: "user", text: "Hello" })
  expect(Expected.text("Hi")).toStrictEqual({ type: "text", text: "Hi" })
  expect(Expected.reasoning("Think")).toStrictEqual({ type: "reasoning", text: "Think" })
  expect(Expected.assistant("stop", [Expected.text("Hi")])).toStrictEqual({
    type: "assistant",
    finish: "stop",
    content: [{ type: "text", text: "Hi" }],
  })
})

test("keeps tool identity, status, input, content, and metadata explicit", () => {
  expect(
    Expected.completedTool(
      { id: "call-echo", name: "echo" },
      {
        input: { text: "Hello" },
        content: [Expected.text("Hello")],
        metadata: { title: "Echo" },
      },
    ),
  ).toStrictEqual({
    type: "tool",
    id: "call-echo",
    name: "echo",
    state: {
      status: "completed",
      input: { text: "Hello" },
      content: [{ type: "text", text: "Hello" }],
      metadata: { title: "Echo" },
    },
  })
  expect(Expected.failedTool({ id: "call-echo", name: "echo" }, { error: { message: "Denied" } })).toStrictEqual({
    type: "tool",
    id: "call-echo",
    name: "echo",
    state: { status: "error", error: { message: "Denied" } },
  })
})

test("distinguishes omitted fields from explicit undefined without mutating input", () => {
  const fields = Object.freeze({ input: Object.freeze({ text: "Hello" }), metadata: undefined })
  const expected = Expected.completedTool({ id: "call-echo", name: "echo" }, fields)
  expect(Object.hasOwn(expected.state, "metadata")).toBe(true)
  expect(Object.hasOwn(expected.state, "content")).toBe(false)
  expect(expected.state).not.toBe(fields)
  expect(fields).toStrictEqual({ input: { text: "Hello" }, metadata: undefined })
  expect(Expected.failedTool({ id: "call-echo" }, {})).toStrictEqual({
    type: "tool",
    id: "call-echo",
    state: { status: "error" },
  })
})

test("composes with ordinary asymmetric matchers and extra fields", () => {
  const content = expect.arrayContaining([Expected.text(expect.stringContaining("Hello"))])
  const expected = { ...Expected.assistant("stop", content), snapshot: { files: ["hello.txt"] } }
  const actual = {
    type: "assistant",
    finish: "stop",
    content: [{ type: "text", text: "Hello there" }],
    snapshot: { start: "before", end: "after", files: ["hello.txt"] },
    time: { created: 1, completed: 2 },
  }
  expect(expected.content).toBe(content)
  expect(actual).toMatchObject(expected)
  expect({ ...actual, finish: "error" }).not.toMatchObject(expected)
  expect({ ...actual, content: [{ type: "text", text: "Goodbye" }] }).not.toMatchObject(expected)
})

test("does not infer expected output from input or ignore a different tool identity", () => {
  const expected = Expected.completedTool(
    { id: "call-echo", name: "echo" },
    {
      input: { text: "Hello" },
      content: [Expected.text("Different output")],
    },
  )
  const actual = {
    type: "tool",
    id: "call-echo",
    name: "echo",
    state: { status: "completed", input: { text: "Hello" }, content: [{ type: "text", text: "Different output" }] },
  }
  expect(actual).toStrictEqual(expected)
  expect({ ...actual, id: "other-call" }).not.toMatchObject(expected)
  expect({ ...actual, name: "other-tool" }).not.toMatchObject(expected)
  expect({ ...actual, state: { ...actual.state, status: "error" } }).not.toMatchObject(expected)
})
