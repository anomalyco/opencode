import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { appendMessageFeedback, exportMessageFeedback } from "./message-feedback"

type Item = Parameters<typeof exportMessageFeedback>[0][number]

const item = (role: Item["role"], id: string, comment = `comment ${id}`): Item => ({
  role,
  quote: `quote ${id}`,
  comment,
})

describe("message feedback", () => {
  test("exportMessageFeedback preserves input order and role labels", () => {
    expect(exportMessageFeedback([item("user", "a"), item("assistant", "b")])).toBe(`# Conversation Feedback

Please use the following annotated excerpts from the conversation when generating the next reply.

## 1. user message

**Selected text**
\`\`\`
quote a
\`\`\`

**Comment**
> comment a

## 2. assistant message

**Selected text**
\`\`\`
quote b
\`\`\`

**Comment**
> comment b`)
  })

  test("exportMessageFeedback blockquotes multi-line comments", () => {
    expect(exportMessageFeedback([item("assistant", "a", "first\nsecond")])).toContain("**Comment**\n> first\n> second")
  })

  test("appendMessageFeedback appends a trailing text part without mutating prompt", () => {
    const prompt: Prompt = [
      { type: "text", content: "Draft", start: 0, end: 5 },
      { type: "agent", content: "@helper", start: 5, end: 12, name: "helper" },
    ]
    const next = appendMessageFeedback(prompt, "# Conversation Feedback")

    expect(next).toEqual([
      { type: "text", content: "Draft", start: 0, end: 5 },
      { type: "agent", content: "@helper", start: 5, end: 12, name: "helper" },
      { type: "text", content: "\n\n# Conversation Feedback", start: 0, end: 25 },
    ])
    expect(next).not.toBe(prompt)
    expect(next[0]).not.toBe(prompt[0])
    expect(next[1]).not.toBe(prompt[1])
    expect(prompt).toEqual([
      { type: "text", content: "Draft", start: 0, end: 5 },
      { type: "agent", content: "@helper", start: 5, end: 12, name: "helper" },
    ])
  })

  test("appendMessageFeedback appends markdown directly when prompt text is empty", () => {
    const prompt: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

    expect(appendMessageFeedback(prompt, "# Conversation Feedback")).toEqual([
      { type: "text", content: "", start: 0, end: 0 },
      { type: "text", content: "# Conversation Feedback", start: 0, end: 23 },
    ])
  })
})
