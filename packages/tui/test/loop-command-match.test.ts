// `/loop` and `/queue` are intercepted before server prompt-templates so they
// can take arguments. The matcher decides whether a line is a command or an
// ordinary message, so a mistake here either swallows someone's message or
// silently sends a command to the model as prose.
import { describe, expect, test } from "bun:test"

// Mirrors isLoopCommand in component/prompt/index.tsx. Kept in the test rather
// than exported from a 2000-line component module; the rule is small enough
// that duplicating it is cheaper than the import surface.
function isLoopCommand(input: string): boolean {
  for (const verb of ["/loop", "/queue"]) {
    if (input === verb || input.startsWith(`${verb} `) || input.startsWith(`${verb}\n`)) return true
  }
  return false
}

describe("loop/queue command matching", () => {
  test("bare verbs are commands", () => {
    expect(isLoopCommand("/loop")).toBe(true)
    expect(isLoopCommand("/queue")).toBe(true)
  })

  test("verbs with arguments are commands", () => {
    expect(isLoopCommand("/loop keep working until done")).toBe(true)
    expect(isLoopCommand("/queue retire-auto-reply --sync")).toBe(true)
    expect(isLoopCommand("/loop --queue")).toBe(true)
  })

  test("a multi-line prompt still matches on its first line", () => {
    expect(isLoopCommand("/loop\nkeep going")).toBe(true)
    expect(isLoopCommand("/queue\nretire-auto-reply")).toBe(true)
  })

  test("a real message that merely starts with the letters is NOT a command", () => {
    // The failure that matters: swallowing someone's actual question.
    expect(isLoopCommand("/loopback is broken")).toBe(false)
    expect(isLoopCommand("/queued jobs are stuck")).toBe(false)
    expect(isLoopCommand("why does /loop stall?")).toBe(false)
    expect(isLoopCommand("/loops")).toBe(false)
  })

  test("ordinary prose is never a command", () => {
    expect(isLoopCommand("")).toBe(false)
    expect(isLoopCommand("loop the queue")).toBe(false)
  })
})
