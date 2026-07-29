import { describe, expect, test } from "bun:test"
import {
  contractPart,
  DEFAULT_COMPLETION_TOKEN,
  matchesCompletion,
  promptDisablesCompletion,
} from "@/loop/completion"

const TOKEN = DEFAULT_COMPLETION_TOKEN
const PROMPT = "refactor the parser"

describe("contractPart", () => {
  test("names the exact token the model must emit", () => {
    const part = contractPart(TOKEN, 3, 50)
    expect(part).toContain(TOKEN)
  })

  test("states the current position in the loop", () => {
    expect(contractPart(TOKEN, 3, 50)).toContain("iteration 3 of 50")
  })

  test("carries a custom token verbatim", () => {
    const custom = "<promise>TASK_COMPLETE</promise>"
    expect(contractPart(custom, 1, 10)).toContain(custom)
  })
})

describe("matchesCompletion", () => {
  test("trailing token on its own line completes", () => {
    const output = `Everything is wired up and the tests pass.\n${TOKEN}`
    expect(matchesCompletion(output, TOKEN, PROMPT)).toBe(true)
  })

  test("token inside a closing code fence completes", () => {
    const output = `Done.\n\`\`\`\n${TOKEN}\n\`\`\``
    expect(matchesCompletion(output, TOKEN, PROMPT)).toBe(true)
  })

  test("lowercase token completes", () => {
    const output = "all done\n<promise>complete</promise>"
    expect(matchesCompletion(output, TOKEN, PROMPT)).toBe(true)
  })

  test("token split across a line break completes", () => {
    const output = "all done\n<promise>\nCOMPLETE\n</promise>"
    expect(matchesCompletion(output, TOKEN, PROMPT)).toBe(true)
  })

  test("mid-response mention followed by more work does not complete", () => {
    const output = `I will emit ${TOKEN} once I am finished.\n` + "Now continuing with the work. ".repeat(30)
    expect(matchesCompletion(output, TOKEN, PROMPT)).toBe(false)
  })

  test("echo of a prompt containing the token does not complete", () => {
    const echoingPrompt = `keep going until you can emit ${TOKEN}`
    const output = `You asked me to keep going until I can emit ${TOKEN}`
    expect(matchesCompletion(output, TOKEN, echoingPrompt)).toBe(false)
  })

  test("output with no token does not complete", () => {
    expect(matchesCompletion("still working on it", TOKEN, PROMPT)).toBe(false)
  })

  test("empty token never completes", () => {
    expect(matchesCompletion(`done ${TOKEN}`, "", PROMPT)).toBe(false)
  })

  test("a different configured token completes", () => {
    const custom = "<promise>TASK_COMPLETE</promise>"
    expect(matchesCompletion(`finished\n${custom}`, custom, PROMPT)).toBe(true)
    expect(matchesCompletion(`finished\n${TOKEN}`, custom, PROMPT)).toBe(false)
  })
})

describe("promptDisablesCompletion", () => {
  test("true when the prompt carries the token", () => {
    expect(promptDisablesCompletion(`emit ${TOKEN} when done`, TOKEN)).toBe(true)
  })

  test("false for an ordinary prompt", () => {
    expect(promptDisablesCompletion(PROMPT, TOKEN)).toBe(false)
  })

  test("false for an empty token", () => {
    expect(promptDisablesCompletion(PROMPT, "")).toBe(false)
  })
})
