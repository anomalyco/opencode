import { describe, expect, test } from "bun:test"
import { readSideChatAnswer, sideChatDescription, sideChatPrompt } from "./side-chat.js"

describe("readSideChatAnswer", () => {
  test("an answer without a note reads as is", () => {
    expect(readSideChatAnswer("  Use a fake clock.  ")).toEqual({ answer: "Use a fake clock.", note: undefined })
  })

  test("a trailing note leaves the answer and is passed on", () => {
    expect(
      readSideChatAnswer("I'll pass that on.\n\n<to-agent>\nKeep the fake clock; don't raise the timeout.\n</to-agent>\n"),
    ).toEqual({ answer: "I'll pass that on.", note: "Keep the fake clock; don't raise the timeout." })
  })

  test("the last of several notes wins, and an empty one is not a note", () => {
    expect(readSideChatAnswer("A <to-agent>first</to-agent>\n\n\n\nB <to-agent>second</to-agent>")).toEqual({
      answer: "A \n\nB",
      note: "second",
    })
    expect(readSideChatAnswer("Done.<to-agent>  </to-agent>")).toEqual({ answer: "Done.", note: undefined })
  })
})

test("a follow-up prompt carries the thread's earlier turns before the question", () => {
  const prompt = sideChatPrompt([{ question: "Why?", answer: "Timers." }], "And now?")

  expect(prompt).toContain("<to-agent>")
  expect(prompt.endsWith("Earlier in this side conversation:\n\nUser: Why?\n\nYou: Timers.\n\nUser: And now?")).toBe(true)
})

test("descriptions stay one short line", () => {
  expect(sideChatDescription("  why\nso   late? ")).toBe("/btw · why so late?")
  expect(sideChatDescription("x".repeat(100))).toHaveLength(7 + 80)
})
