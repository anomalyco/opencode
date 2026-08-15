import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { DoomLoop } from "../../src/session/doom-loop"

function model(id: string) {
  return { providerID: "test", api: { id } } as Provider.Model
}

describe("session.doom-loop", () => {
  test("strips only when the action is ask on a minimal-tier model", () => {
    expect(DoomLoop.shouldStrip("ask", model("qwen3.5-4b"))).toBe(true)
    expect(DoomLoop.shouldStrip("deny", model("qwen3.5-4b"))).toBe(false)
    expect(DoomLoop.shouldStrip("allow", model("qwen3.5-4b"))).toBe(false)
    expect(DoomLoop.shouldStrip("ask", model("claude-sonnet-4-5"))).toBe(false)
    expect(DoomLoop.shouldStrip("ask", model("qwen3.6-35b-a3b"))).toBe(false)
    expect(DoomLoop.shouldStrip("ask", model("some-unknown-model"))).toBe(false)
  })

  test("stripped tools stay out for exactly STRIP_REQUESTS requests", () => {
    const sessionID = "ses_doom-loop-unit"
    expect(DoomLoop.consume(sessionID).size).toBe(0)

    DoomLoop.strip(sessionID, "webfetch")
    expect(DoomLoop.STRIP_REQUESTS).toBe(2)
    expect(DoomLoop.consume(sessionID)).toEqual(new Set(["webfetch"]))
    expect(DoomLoop.consume(sessionID)).toEqual(new Set(["webfetch"]))
    expect(DoomLoop.consume(sessionID).size).toBe(0)
  })

  test("re-stripping resets the budget and sessions are independent", () => {
    const sessionID = "ses_doom-loop-reset"
    DoomLoop.strip(sessionID, "bash")
    expect(DoomLoop.consume(sessionID)).toEqual(new Set(["bash"]))
    DoomLoop.strip(sessionID, "bash")
    expect(DoomLoop.consume(sessionID)).toEqual(new Set(["bash"]))
    expect(DoomLoop.consume(sessionID)).toEqual(new Set(["bash"]))
    expect(DoomLoop.consume(sessionID).size).toBe(0)
    expect(DoomLoop.consume("ses_doom-loop-other").size).toBe(0)
  })

  test("recovery text names the tool with an explicit negative instruction", () => {
    expect(DoomLoop.recovery("webfetch")).toBe(
      "Tool webfetch disabled after repeated identical calls. Do not call webfetch again this turn. Summarize what you have and finish.",
    )
  })
})
