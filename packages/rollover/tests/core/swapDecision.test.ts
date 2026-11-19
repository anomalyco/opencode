import { describe, expect, test } from "bun:test"
import { decideSwap } from "../../src/core/swapDecision"
import type { NMessage } from "../../src/core/types"
import type { SessionState } from "../../src/core/types"

function msg(id: string, role: "user" | "assistant", parts: NMessage["parts"] = [{ type: "text", text: "x" }]): NMessage {
  return { id, role, parts, createdAt: 0 }
}

function baseState(over: Partial<SessionState> = {}): SessionState {
  return {
    v: 1,
    sessionId: "s1",
    settings: {},
    epoch: 0,
    extractedUntilMessageId: "a1",
    lastContextTokens: 200000,
    lastContextSource: "usage",
    lastContextAt: 0,
    rollover: null,
    decidedUserMessageIds: [],
    consolidatedAtRecordCount: 0,
    touchedFiles: {},
    ...over,
  }
}

const realUser = (id: string) => msg(id, "user", [{ type: "text", text: "hello" }])

describe("decideSwap", () => {
  const common = {
    thresholdValue: 100000,
    toolsOpen: false,
    contextTokens: 200000,
  }

  test("swap when all conditions hold", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const d = decideSwap({ msgs, st: baseState(), ...common })
    expect(d).toEqual({ action: "swap", userMessageId: "u2" })
  })

  test("last is assistant → none, not decided", () => {
    const msgs = [realUser("u1"), msg("a2", "assistant")]
    const d = decideSwap({ msgs, st: baseState({ extractedUntilMessageId: "a2" }), ...common })
    expect(d).toEqual({ action: "none", markDecided: false, userMessageId: "a2" })
  })

  test("last is synthetic-only user → none", () => {
    const msgs = [msg("a1", "assistant"), msg("u2", "user", [{ type: "text", text: "wake", synthetic: true }])]
    const d = decideSwap({ msgs, st: baseState(), ...common })
    expect(d.action).toBe("none")
    expect((d as { markDecided: boolean }).markDecided).toBe(false)
  })

  test("last text starts with rollover prefix → none", () => {
    const msgs = [msg("a1", "assistant"), msg("u2", "user", [{ type: "text", text: "<rollover_context epoch='1'>x" }])]
    const d = decideSwap({ msgs, st: baseState(), ...common })
    expect(d.action).toBe("none")
  })

  test("already decided → none, not re-decided", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const d = decideSwap({ msgs, st: baseState({ decidedUserMessageIds: ["u2"] }), ...common })
    expect(d).toEqual({ action: "none", markDecided: false, userMessageId: "u2" })
  })

  test("no previous assistant → none", () => {
    const msgs = [realUser("u1")]
    const d = decideSwap({ msgs, st: baseState(), ...common })
    expect(d.action).toBe("none")
    expect((d as { markDecided: boolean }).markDecided).toBe(false)
  })

  test("below threshold → none, markDecided true", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const d = decideSwap({ msgs, st: baseState(), thresholdValue: 100000, extractionCaughtUp: true, toolsOpen: false, contextTokens: 50000 })
    expect(d).toEqual({ action: "none", markDecided: true, userMessageId: "u2" })
  })

  test("open tools → defer", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const d = decideSwap({ msgs, st: baseState(), ...common, toolsOpen: true })
    expect(d).toEqual({ action: "defer", reason: "open_tools", userMessageId: "u2" })
  })

  test("swap fires with the extraction cursor never advanced (v2: no extraction precondition)", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const st = baseState({ extractedUntilMessageId: null })
    const d = decideSwap({ msgs, st, ...common })
    expect(d).toEqual({ action: "swap", userMessageId: "u2" })
  })

  test("swap fires with the cursor behind the last assistant (extraction cannot gate the swap)", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const st = baseState({ extractedUntilMessageId: "other" })
    const d = decideSwap({ msgs, st, ...common })
    expect(d).toEqual({ action: "swap", userMessageId: "u2" })
  })

  test("ignoreDecided re-evaluates a prompt the automatic flow already decided", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const st = baseState({ decidedUserMessageIds: ["u2"] })
    const d = decideSwap({ msgs, st, ...common, ignoreDecided: true })
    expect(d).toEqual({ action: "swap", userMessageId: "u2" })
  })

  test("contextTokens falls back to st.lastContextTokens", () => {
    const msgs = [msg("a1", "assistant"), realUser("u2")]
    const st = baseState({ lastContextTokens: 200000 })
    const d = decideSwap({ msgs, st, thresholdValue: 100000, toolsOpen: false, contextTokens: null })
    expect(d.action).toBe("swap")
  })

  test("background wake-up (synthetic shell marker) → none", () => {
    const msgs = [msg("a1", "assistant"), msg("u2", "user", [{ type: "text", text: '<shell id="sh_1" state="completed" command="x">' }])]
    const d = decideSwap({ msgs, st: baseState(), ...common })
    expect(d.action).toBe("none")
  })

  test("anchor lastUser: decision anchors on the last real user message (command-time, last is the assistant reply)", () => {
    const msgs = [realUser("u1"), msg("a1", "assistant"), realUser("u2"), msg("a2", "assistant")]
    // default anchor: the last message is the assistant's reply → none
    expect(decideSwap({ msgs, st: baseState(), ...common }).action).toBe("none")
    // command-time anchor: the last real user message decides
    const d = decideSwap({ msgs, st: baseState({ extractedUntilMessageId: "a2" }), ...common, anchor: "lastUser" })
    expect(d).toEqual({ action: "swap", userMessageId: "u2" })
    // already-decided anchor → none
    const d2 = decideSwap({
      msgs,
      st: baseState({ extractedUntilMessageId: "a2", decidedUserMessageIds: ["u2"] }),
      ...common,
      anchor: "lastUser",
    })
    expect(d2.action).toBe("none")
  })
})
