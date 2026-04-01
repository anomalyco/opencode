import { describe, expect, test } from "bun:test"
import { bodyText, inputMatch, promptMatch } from "../../e2e/prompt/mock"

function hit(body: Record<string, unknown>) {
  return { body }
}

describe("promptMatch", () => {
  test("matches token in serialized body", () => {
    const match = promptMatch("hello")
    expect(match(hit({ messages: [{ role: "user", content: "say hello" }] }))).toBe(true)
    expect(match(hit({ messages: [{ role: "user", content: "say goodbye" }] }))).toBe(false)
  })
})

describe("inputMatch", () => {
  test("matches exact tool input in chat completions body", () => {
    const input = { questions: [{ header: "Need input", question: "Pick one" }] }
    const match = inputMatch(input)

    // The seed prompt embeds JSON.stringify(input) in the user message
    const prompt = `Use this JSON input: ${JSON.stringify(input)}`
    const body = { messages: [{ role: "user", content: prompt }] }
    expect(match(hit(body))).toBe(true)
  })

  test("matches exact tool input in responses API body", () => {
    const input = { questions: [{ header: "Need input", question: "Pick one" }] }
    const match = inputMatch(input)

    const prompt = `Use this JSON input: ${JSON.stringify(input)}`
    const body = { model: "test", input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
    expect(match(hit(body))).toBe(true)
  })

  test("matches patchText with newlines", () => {
    const patchText = "*** Begin Patch\n*** Add File: test.txt\n+line1\n*** End Patch"
    const match = inputMatch({ patchText })

    const prompt = `Use this JSON input: ${JSON.stringify({ patchText })}`
    const body = { messages: [{ role: "user", content: prompt }] }
    expect(match(hit(body))).toBe(true)

    // Also works in responses API format
    const respBody = { model: "test", input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }] }
    expect(match(hit(respBody))).toBe(true)
  })

  test("does not match unrelated requests", () => {
    const input = { questions: [{ header: "Need input" }] }
    const match = inputMatch(input)

    expect(match(hit({ messages: [{ role: "user", content: "hello" }] }))).toBe(false)
    expect(match(hit({ model: "test", input: [] }))).toBe(false)
  })

  test("does not match partial input", () => {
    const input = { questions: [{ header: "Need input", question: "Pick one" }] }
    const match = inputMatch(input)

    // Only header, missing question
    const partial = `Use this JSON input: ${JSON.stringify({ questions: [{ header: "Need input" }] })}`
    const body = { messages: [{ role: "user", content: partial }] }
    expect(match(hit(body))).toBe(false)
  })
})
