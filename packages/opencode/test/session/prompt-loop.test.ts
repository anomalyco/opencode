import { expect, test } from "bun:test"
import { shouldExitPromptLoop } from "../../src/session/prompt-loop"

test("exits when the latest assistant finished as a reply to the latest user", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_200",
      lastAssistant: {
        id: "msg_199",
        parentID: "msg_200",
        finish: "stop",
      },
      hasToolCalls: false,
    }),
  ).toBe(true)
})

test("does not exit when the latest assistant belongs to an older user message", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_300",
      lastAssistant: {
        id: "msg_400",
        parentID: "msg_200",
        finish: "stop",
      },
      hasToolCalls: false,
    }),
  ).toBe(false)
})

test("does not exit when the assistant requested tool calls", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_200",
      lastAssistant: {
        id: "msg_300",
        parentID: "msg_200",
        finish: "tool-calls",
      },
      hasToolCalls: false,
    }),
  ).toBe(false)
})

test("does not exit while non-provider-executed tool calls remain", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_200",
      lastAssistant: {
        id: "msg_300",
        parentID: "msg_200",
        finish: "stop",
      },
      hasToolCalls: true,
    }),
  ).toBe(false)
})

test("does not exit before an assistant finish reason exists", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_200",
      lastAssistant: {
        id: "msg_300",
        parentID: "msg_200",
      },
      hasToolCalls: false,
    }),
  ).toBe(false)
})

test("does not exit when no assistant message exists yet", () => {
  expect(
    shouldExitPromptLoop({
      lastUserID: "msg_200",
      hasToolCalls: false,
    }),
  ).toBe(false)
})
