import { describe, expect, test } from "bun:test"
import {
  REASONING_LOOP_NUDGE,
  fastRuleEnabled,
  loopNudgeParts,
  loopNudgeText,
  reasoningLoopDetector,
  repeatRuleEnabled,
} from "../src/session/llm/reasoning-loop"

const WORDS = (
  "the parser cursor token node range printer lexer buffer offset scope module import export " +
  "replica gateway stream budget shard expert router queue latency socket fabric kernel cache " +
  "check verify plan section item file line value config field step next read write call result"
).split(" ")

// Deterministic pseudo-random prose: no verbatim 110-char repeats of its own.
function prose(chars: number, seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  let out = ""
  let words = 0
  while (out.length < chars) {
    out += WORDS[next() % WORDS.length]
    words++
    out += words % 13 === 0 ? ".\n" : " "
  }
  return out.slice(0, chars)
}

function feedAll(
  detector: ReturnType<typeof reasoningLoopDetector>,
  text: string,
  source: "reasoning" | "text" = "reasoning",
  chunk = 37,
) {
  for (let at = 0; at < text.length; at += chunk) {
    if (detector.feed(text.slice(at, at + chunk), source)) return true
  }
  return false
}

const cleanText = [
  "The parser reads a token, then advances the cursor past any whitespace.",
  "If the token is a number we build a literal node and attach its source range.",
  "A string token keeps its escape sequences until the printer normalizes them.",
  "When the cursor reaches the end of input the parser returns the root node.",
  "Errors carry the byte offset so the editor can underline the exact span.",
  "The formatter walks the tree twice: once to measure, once to emit.",
  "Comments are attached to the nearest following statement, not the previous one.",
  "A trailing comma is accepted in arrays and objects but not in call arguments.",
  "The lexer caches the last identifier to avoid re-scanning the same bytes.",
  "Nested templates are parsed recursively with a depth guard of sixty-four.",
  "Each node records whether it was parenthesized so the printer can preserve it.",
  "The test suite compares the printed output against a golden fixture.",
].join("\n")

describe("reasoningLoopDetector", () => {
  test("fires on a repeated reasoning block", () => {
    const detector = reasoningLoopDetector()
    expect(feedAll(detector, prose(2000, 1) + prose(1437, 2).repeat(10))).toBe(true)
    expect(detector.fired).toBe(true)
  })

  test("does not fire on clean prose", () => {
    expect(feedAll(reasoningLoopDetector(), prose(60_000, 3))).toBe(false)
    expect(feedAll(reasoningLoopDetector(), cleanText)).toBe(false)
  })

  test("does not fire on structured answer text", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `| ${i} | ${WORDS[i % WORDS.length]} | ${(i * 37) % 101} | ok |`)
    const table = "| id | name | value | status |\n|---|---|---|---|\n" + rows.join("\n") + "\n"
    const template = "| TODO | TODO | TODO | TODO | TODO |\n".repeat(20)
    const css = Array.from(
      { length: 30 },
      (_, i) => `.item-${i} {\n  margin: 0;\n  padding: ${i}px;\n  color: #${(i * 4099).toString(16).padStart(6, "0")};\n}\n`,
    ).join("")
    const html = Array.from({ length: 30 }, (_, i) => `<li class="row"><a href="/p/${i}">Page ${i}</a></li>\n`).join("")
    for (const text of [table, template, css, html, cleanText]) {
      expect(feedAll(reasoningLoopDetector(), text, "text")).toBe(false)
    }
  })

  test("the line and period rules only look at reasoning", () => {
    const line = "I will check the gateway config once more."
    const lines = `${line}\n`.repeat(20)
    expect(feedAll(reasoningLoopDetector(), lines, "text")).toBe(false)
    expect(feedAll(reasoningLoopDetector(), lines, "reasoning")).toBe(true)

    const unit = prose(150, 4)
    const cycle = prose(2000, 5) + unit.repeat(8)
    expect(feedAll(reasoningLoopDetector(), cycle, "text")).toBe(false)
    expect(feedAll(reasoningLoopDetector(), cycle, "reasoning")).toBe(true)
  })

  test("the nudge carries the work before the loop and no copy of it", () => {
    const pre = prose(3000, 6)
    const unit = prose(1437, 7)
    const { text } = loopNudgeText(loopNudgeParts(pre + unit.repeat(9)))
    expect(text.startsWith(REASONING_LOOP_NUDGE)).toBe(true)
    expect(text).toContain(pre)
    for (let at = 0; at + 64 <= unit.length; at += 64) expect(text).not.toContain(unit.slice(at, at + 64))
  })

  test("kill switches", () => {
    expect(repeatRuleEnabled({})).toBe(true)
    for (const off of ["0", "false", "off", "no"]) expect(repeatRuleEnabled({ OPENCODE_LOOP_REPEAT_DETECT: off })).toBe(false)
    expect(fastRuleEnabled({})).toBe(true)
    for (const off of ["0", "false", "off", "no"]) expect(fastRuleEnabled({ OPENCODE_LOOP_FAST_DETECT: off })).toBe(false)
  })
})
