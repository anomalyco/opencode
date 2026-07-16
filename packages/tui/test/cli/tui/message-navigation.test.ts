import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"
import { findMessageBoundary, messageNavigationSlack } from "../../../src/routes/session/message-navigation"

const messages: SessionMessageInfo[] = [
  { type: "user", id: "user-1", text: "First", time: { created: 0 } },
  assistant("assistant-1", "Response"),
  { type: "user", id: "user-2", text: "Second", time: { created: 2 } },
]
const children = [
  { id: "user-1", y: 0 },
  { id: "assistant-1", y: 20 },
  { id: "user-2", y: 40 },
]

test("adds only enough slack to align the selected message", () => {
  expect(messageNavigationSlack({ top: 80, viewportHeight: 50, scrollHeight: 100, currentSlack: 0 })).toBe(30)
  expect(messageNavigationSlack({ top: 20, viewportHeight: 50, scrollHeight: 130, currentSlack: 30 })).toBe(0)
})

test("finds the next user message without stopping at an assistant message", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      userOnly: true,
    }),
  ).toEqual({ id: "user-2", y: 40, top: 40 })
})

test("finds the previous user message without stopping at an assistant message", () => {
  expect(
    findMessageBoundary({
      direction: "prev",
      children: children.map((child) => ({ ...child, y: child.y - 35 })),
      messages,
      scrollTop: 35,
      viewportY: 0,
      userOnly: true,
    }),
  ).toEqual({ id: "user-1", y: 0, top: 0 })
})

test("preserves navigation across both user and assistant messages", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
    }),
  ).toEqual({ id: "assistant-1", y: 20, top: 19 })
  expect(
    findMessageBoundary({
      direction: "prev",
      children: children.map((child) => ({ ...child, y: child.y - 35 })),
      messages,
      scrollTop: 35,
      viewportY: 0,
    }),
  ).toEqual({ id: "assistant-1", y: 20, top: 19 })
})

test("uses the selected message when the viewport is too tall to scroll", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-1",
      userOnly: true,
    }),
  ).toEqual({ id: "user-2", y: 40, top: 40 })
  expect(
    findMessageBoundary({
      direction: "prev",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-2",
      userOnly: true,
    }),
  ).toEqual({ id: "user-1", y: 0, top: 0 })
})

test("stops at the first and last selected user message", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-2",
      userOnly: true,
    }),
  ).toBeNull()
  expect(
    findMessageBoundary({
      direction: "prev",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-1",
      userOnly: true,
    }),
  ).toBeNull()
})

test("keeps the logical boundary when layout temporarily moves it outside the viewport", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-2",
      userOnly: true,
    }),
  ).toBeNull()
})

test("stops at the first and last message", () => {
  expect(
    findMessageBoundary({
      direction: "next",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-2",
    }),
  ).toBeNull()
  expect(
    findMessageBoundary({
      direction: "prev",
      children,
      messages,
      scrollTop: 0,
      viewportY: 0,
      currentID: "user-1",
    }),
  ).toBeNull()
})

function assistant(id: string, text: string): SessionMessageAssistant {
  return {
    type: "assistant",
    id,
    agent: "build",
    model: { providerID: "test", id: "test" },
    content: [{ type: "text", text }],
    time: { created: 1, completed: 1 },
  }
}
