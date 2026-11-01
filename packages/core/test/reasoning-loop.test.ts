import { describe, expect, test } from "bun:test"
import {
  LOOP_AT_CAP,
  REASONING_LOOP_NUDGE,
  fastRuleEnabled,
  LOOP_NUDGE_MAX_CHARS,
  loopKeep,
  loopNudgeParts,
  loopNudgeText,
  loopOnset,
  reasoningLoopDetector,
  reasoningLoopMetrics,
  repeatRuleEnabled,
} from "../src/session/llm/reasoning-loop"

const LOOP_LINE = "I need to check the file again and again.\n"
const loopText = LOOP_LINE.repeat(200)

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

// A settled loop from the audit: zlib is low but duplicate-line is 0.869,
// below the conservative 0.9 gate, so it must not trigger.
const settledLoopText = [
  ...Array.from({ length: 87 }, () => "I should verify the same thing once more."),
  ...Array.from({ length: 13 }, (_, index) => `Distinct observation number ${index} about the build.`),
].join("\n")

describe("reasoningLoopMetrics", () => {
  test("a repeated line has a low zlib ratio and a high duplicate-line ratio", () => {
    const metrics = reasoningLoopMetrics(loopText)
    expect(metrics.zlib).toBeLessThan(0.05)
    expect(metrics.duplicateLine).toBeGreaterThan(0.9)
    expect(metrics.unique5Gram).toBeLessThan(0.3)
  })

  test("clean prose has a high zlib ratio and a high unique 5-gram ratio", () => {
    const metrics = reasoningLoopMetrics(cleanText)
    expect(metrics.zlib).toBeGreaterThan(0.2)
    expect(metrics.unique5Gram).toBeGreaterThan(0.8)
  })
})

describe("reasoningLoopDetector", () => {
  test("triggers on a known uncontrolled loop", () => {
    const detector = reasoningLoopDetector()
    let fired = false
    for (let at = 0; at < loopText.length; at += 64) {
      if (detector.feed(loopText.slice(at, at + 64))) fired = true
    }
    expect(fired).toBe(true)
    expect(detector.fired).toBe(true)
  })

  test("does not trigger on clean reasoning", () => {
    const detector = reasoningLoopDetector()
    let fired = false
    for (let at = 0; at < cleanText.length; at += 64) {
      if (detector.feed(cleanText.slice(at, at + 64))) fired = true
    }
    expect(fired).toBe(false)
  })

  test("tight rule does not trigger on a settled loop below the conservative duplicate-line gate", () => {
    const metrics = reasoningLoopMetrics(settledLoopText)
    expect(metrics.zlib).toBeLessThan(0.05)
    expect(metrics.duplicateLine).toBeLessThan(0.9)
    // The exact-repeat rule DOES fire here (87 verbatim copies of one line);
    // this test pins the tight rule's own gate (the fast rules fire too).
    const detector = reasoningLoopDetector({ repeat: false, fast: false })
    let fired = false
    for (let at = 0; at < settledLoopText.length; at += 64) {
      if (detector.feed(settledLoopText.slice(at, at + 64))) fired = true
    }
    expect(fired).toBe(false)
  })

  test("fires at most once per detector", () => {
    const detector = reasoningLoopDetector()
    let hits = 0
    for (let at = 0; at < loopText.length; at += 64) {
      if (detector.feed(loopText.slice(at, at + 64))) hits++
    }
    expect(hits).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Exact-repeat rule (LD-05): 110-char shingle, seen >= 2 earlier, run >= 1,800.
// ---------------------------------------------------------------------------

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

function feedAll(detector: ReturnType<typeof reasoningLoopDetector>, text: string, chunk = 37) {
  for (let at = 0; at < text.length; at += chunk) {
    if (detector.feed(text.slice(at, at + chunk))) return detector.metrics().chars
  }
  return undefined
}

describe("reasoningLoopDetector exact-repeat rule", () => {
  test("a 2,000-char block repeated 8 times fires during the eighth copy", () => {
    const block = prose(2000, 1)
    const at = feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), block.repeat(8))
    expect(at).toBeDefined()
    expect(at!).toBeGreaterThan(14_000)
    expect(at!).toBeLessThanOrEqual(16_000)
    // exactly when 1,800 consecutive eighth-copy shingles have been seen
    expect(at).toBe(14_000 + 110 - 1 + 1800)
  })

  test("a 700-char block fires once ~1,900 chars are eighth-or-later copies", () => {
    const at = feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), prose(700, 2).repeat(12))
    expect(at).toBe(4900 + 110 - 1 + 1800)
  })

  test("a block repeated only twice (draft, then write) never fires", () => {
    const draft = prose(3000, 3)
    const detector = reasoningLoopDetector({ repeat: true })
    expect(feedAll(detector, prose(4000, 4) + draft + prose(500, 5) + draft + prose(4000, 6))).toBeUndefined()
    expect(detector.fired).toBe(false)
  })

  test("long non-repeating prose never fires", () => {
    const detector = reasoningLoopDetector({ repeat: true })
    expect(feedAll(detector, prose(60_000, 7))).toBeUndefined()
  })

  test("a paragraph-scale loop the tight rule misses fires before char 20,000", () => {
    // Shape of the replica-d capped loops: unique preamble, then a multi-line
    // block (period not a multiple of any stride) repeated verbatim.
    const text = prose(5000, 8) + prose(1437, 9).repeat(20)
    const at = feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), text.slice(0, 25_000))
    expect(at).toBe(5000 + 7 * 1437 + 110 - 1 + 1800)
    expect(at!).toBeLessThan(20_000)
    // the 10-25 tight rule alone never fires on it
    expect(feedAll(reasoningLoopDetector({ repeat: false }), text.slice(0, 25_000))).toBeUndefined()
    // the shipped default (both rules) fires at the repeat point
    expect(feedAll(reasoningLoopDetector(), text.slice(0, 25_000))).toBe(at)
  })

  test("the fire point does not depend on how the stream is chunked", () => {
    const text = prose(3000, 10) + prose(901, 11).repeat(10)
    const points = [1, 7, 64, 4096].map((chunk) =>
      feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), text, chunk),
    )
    expect(new Set(points).size).toBe(1)
    expect(points[0]).toBe(3000 + 7 * 901 + 110 - 1 + 1800)
  })

  test("metrics() reports chars, run and seen", () => {
    const detector = reasoningLoopDetector({ repeat: true, tight: false, fast: false })
    detector.feed(prose(300, 12))
    expect(detector.metrics()).toEqual({ chars: 300, run: 0, seen: 0 })
    feedAll(detector, prose(1000, 13).repeat(10))
    expect(detector.fired).toBe(true)
    expect(detector.rule).toBe("repeat")
    expect(detector.metrics()).toMatchObject({ run: 1800, rule: "repeat" })
    expect(detector.metrics().seen).toBeGreaterThanOrEqual(1800)
  })

  test("reset() clears everything", () => {
    const detector = reasoningLoopDetector({ repeat: true, tight: false, fast: false })
    const block = prose(1000, 14)
    feedAll(detector, block.repeat(10))
    expect(detector.fired).toBe(true)
    detector.reset()
    expect(detector.fired).toBe(false)
    expect(detector.rule).toBeUndefined()
    expect(detector.metrics()).toEqual({ chars: 0, run: 0, seen: 0 })
    // the earlier copies are forgotten: seven more copies are not an eighth
    expect(feedAll(detector, block.repeat(7))).toBeUndefined()
  })

  test("the entry cap stops inserting new shingles, so a loop past it never fires", () => {
    const text = prose(5000, 15) + prose(1000, 16).repeat(10)
    expect(feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false, maxEntries: 1000 }), text)).toBeUndefined()
    expect(feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), text)).toBeDefined()
  })

  test("works on astral-plane text (UTF-16 code units)", () => {
    const block = Array.from({ length: 400 }, (_, i) => String.fromCodePoint(0x1f600 + (i % 79)) + "x").join("")
    expect(feedAll(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), prose(2000, 17) + block.repeat(10))).toBeDefined()
  })

  test("kill switch: OPENCODE_LOOP_REPEAT_DETECT=0 turns the repeat rule off, default is on", () => {
    expect(repeatRuleEnabled({})).toBe(true)
    expect(repeatRuleEnabled({ OPENCODE_LOOP_REPEAT_DETECT: "1" })).toBe(true)
    for (const off of ["0", "false", "off", "no", " FALSE "]) {
      expect(repeatRuleEnabled({ OPENCODE_LOOP_REPEAT_DETECT: off })).toBe(false)
    }
    const text = prose(5000, 18) + prose(1437, 19).repeat(10)
    const previous = process.env.OPENCODE_LOOP_REPEAT_DETECT
    process.env.OPENCODE_LOOP_REPEAT_DETECT = "0"
    try {
      expect(feedAll(reasoningLoopDetector(), text)).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_LOOP_REPEAT_DETECT
      else process.env.OPENCODE_LOOP_REPEAT_DETECT = previous
    }
    expect(feedAll(reasoningLoopDetector(), text)).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// LD-05b fast short-cycle rules (period + line) and the one-copy cut.
// ---------------------------------------------------------------------------

function fireOf(detector: ReturnType<typeof reasoningLoopDetector>, text: string, chunk = 7) {
  for (let at = 0; at < text.length; at += chunk) {
    if (detector.feed(text.slice(at, at + chunk))) return detector.metrics()
  }
  return undefined
}

const FAST = { repeat: false, tight: false } as const

describe("reasoningLoopDetector fast rules (LD-05b)", () => {
  test("period rule: 8 copies of a unit with >= 1,024 repeated chars fire at the exact char", () => {
    const pre = prose(300, 31)
    const unit = prose(100, 32)
    const hit = fireOf(reasoningLoopDetector(FAST), pre + unit.repeat(20))
    // first copy + 7 more copies (700 < 1,024, so the 1,024-char span decides)
    expect(hit).toMatchObject({ rule: "period", period: 100, fireAt: 300 + 100 + 1024 })
  })

  test("period rule: a longer unit needs 8 full copies", () => {
    const pre = prose(300, 33)
    const unit = prose(400, 34)
    expect(fireOf(reasoningLoopDetector(FAST), pre + unit.repeat(7))).toBeUndefined()
    expect(fireOf(reasoningLoopDetector(FAST), pre + unit.repeat(9))).toMatchObject({
      rule: "period",
      period: 400,
      fireAt: 300 + 8 * 400,
    })
  })

  test("period rule fires on a short cycle far earlier than the repeat rule", () => {
    const text = prose(2000, 35) + prose(200, 36).repeat(40)
    const fast = fireOf(reasoningLoopDetector({ repeat: false, tight: false }), text)!
    const slow = fireOf(reasoningLoopDetector({ repeat: true, tight: false, fast: false }), text)!
    expect(fast.fireAt).toBe(2000 + 200 + 1400)
    expect(slow.fireAt! - fast.fireAt!).toBeGreaterThan(1000)
    // default detector = both rules: the earlier one wins
    expect(fireOf(reasoningLoopDetector({ tight: false }), text)).toMatchObject({ rule: "period", fireAt: 3600 })
  })

  test("the same char 1,025 times fires (period 1), 1,024 does not", () => {
    expect(fireOf(reasoningLoopDetector(FAST), "x " + "=".repeat(1024) + " y")).toBeUndefined()
    expect(fireOf(reasoningLoopDetector(FAST), "x " + "=".repeat(1025))).toMatchObject({ period: 1, fireAt: 2 + 1025 })
  })

  test("line rule: 16 identical lines >= 32 chars fire even with irregular blank lines between", () => {
    const line = "I will check the gateway config once more."
    const text = prose(500, 37) + "\n" + Array.from({ length: 20 }, (_, i) => line + "\n".repeat(1 + (i % 3))).join("")
    const hit = fireOf(reasoningLoopDetector(FAST), text)
    expect(hit?.rule).toBe("line")
    const lines = text.slice(0, hit!.fireAt).split("\n").filter((value) => value === line)
    expect(lines).toHaveLength(16)
  })

  test("line rule: 15 identical lines, or short lines, never fire", () => {
    const line = "I will check the gateway config once more."
    expect(fireOf(reasoningLoopDetector(FAST), prose(400, 38) + "\n" + `${line}\n\n`.repeat(15))).toBeUndefined()
    expect(fireOf(reasoningLoopDetector(FAST), "<tr>\n" + "    <td></td>\n".repeat(12) + "</tr>\n")).toBeUndefined()
  })

  test("normal structured output does not fire: tables, CSS, HTML, code, hex", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `| ${i} | ${WORDS[i % WORDS.length]} | ${(i * 37) % 101} | ok |`)
    const table = "| id | name | value | status |\n|---|---|---|---|\n" + rows.join("\n") + "\n"
    const css = Array.from(
      { length: 30 },
      (_, i) => `.item-${i} {\n  margin: 0;\n  padding: ${i}px;\n  color: #${(i * 4099).toString(16).padStart(6, "0")};\n}\n`,
    ).join("")
    const html = Array.from({ length: 30 }, (_, i) => `<li class="row"><a href="/p/${i}">Page ${i}</a></li>\n`).join("")
    const rust = "let kinds = [" + "CUTEAFD_GRAPH_ARG_POINTER, CUTEAFD_GRAPH_ARG_POINTER,\n             ".repeat(5) + "];\n"
    const hex = '"bytes": "2c83240846723350814fed4c0071b81d' + "0".repeat(220) + '",\n'
    for (const text of [table, css, html, rust, hex, cleanText]) {
      expect(fireOf(reasoningLoopDetector(FAST), text)).toBeUndefined()
    }
  })

  test("kill switch: OPENCODE_LOOP_FAST_DETECT=0 turns the fast rules off, default is on", () => {
    expect(fastRuleEnabled({})).toBe(true)
    for (const off of ["0", "false", "off", "no"]) expect(fastRuleEnabled({ OPENCODE_LOOP_FAST_DETECT: off })).toBe(false)
    const text = prose(300, 39) + prose(150, 40).repeat(10)
    const previous = process.env.OPENCODE_LOOP_FAST_DETECT
    process.env.OPENCODE_LOOP_FAST_DETECT = "0"
    try {
      expect(fireOf(reasoningLoopDetector({ repeat: false, tight: false }), text)).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_LOOP_FAST_DETECT
      else process.env.OPENCODE_LOOP_FAST_DETECT = previous
    }
    expect(fireOf(reasoningLoopDetector({ repeat: false, tight: false }), text)).toBeDefined()
  })

  test("reset() clears the fast-rule state", () => {
    const detector = reasoningLoopDetector(FAST)
    const unit = prose(150, 41)
    expect(fireOf(detector, unit.repeat(7))).toBeUndefined()
    detector.reset()
    // without the reset the next 7 copies would complete 8+ copies
    expect(fireOf(detector, unit.repeat(7))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// LD-05d patience: a loop that ends on its own before 8 copies is never cut;
// the LD-05b thresholds survive only for a step that ran out of budget.
// ---------------------------------------------------------------------------

describe("loop patience (LD-05d)", () => {
  const after = prose(4000, 80)
  const cases = [
    ["paragraph unit (repeat rule)", prose(2000, 81)],
    ["short unit (period rule)", prose(150, 82)],
  ] as const

  for (const [name, unit] of cases) {
    test(`${name}: 7 copies that end on their own are not cut; 8 copies are`, () => {
      const pre = prose(2000, 83)
      expect(fireOf(reasoningLoopDetector(), pre + unit.repeat(7) + after)).toBeUndefined()
      const hit = fireOf(reasoningLoopDetector(), pre + unit.repeat(8) + after)
      expect(hit).toBeDefined()
      expect(hit!.fireAt!).toBeGreaterThan(pre.length + 7 * unit.length)
      expect(hit!.fireAt!).toBeLessThanOrEqual(pre.length + 8 * unit.length + 110)
    })
  }

  test("the line rule needs 16 lines: 15 repeated lines that end are not cut", () => {
    const line = "Let me re-read the config file and check the port once more."
    const text = prose(2000, 84) + "\n" + `${line}\n\n`.repeat(15) + after
    expect(fireOf(reasoningLoopDetector({ repeat: false, tight: false }), text)).toBeUndefined()
  })

  test("LOOP_AT_CAP keeps the LD-05b thresholds (3rd copy / 4 copies / 8 lines) for a step that hit the budget", () => {
    const pre = prose(2000, 85)
    const unit = prose(1437, 86)
    expect(feedAll(reasoningLoopDetector({ ...LOOP_AT_CAP, tight: false, fast: false }), pre + unit.repeat(4))).toBe(
      2000 + 2 * 1437 + 110 - 1 + 1800,
    )
    expect(fireOf(reasoningLoopDetector({ ...LOOP_AT_CAP, repeat: false, tight: false }), pre + prose(150, 87).repeat(5)))
      .toMatchObject({ rule: "period", fireAt: 2000 + 150 + 512 })
    expect(feedAll(reasoningLoopDetector(), pre + unit.repeat(4))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// LD-05d paste-back: everything from the loop onset (start of the FIRST copy)
// is cut, from the transcript and from the nudge.
// ---------------------------------------------------------------------------

describe("loop onset cut (LD-05d)", () => {
  test("with a known unit it keeps only the text before the first copy", () => {
    const pre = prose(300, 42)
    const unit = prose(150, 43)
    const fed = (pre + unit.repeat(10)).slice(0, 1562)
    expect(fed.slice(0, loopKeep(fed, 150))).toBe(pre)
  })

  test("with an unknown unit (repeat rule) it finds the unit and cuts at the first copy", () => {
    const pre = prose(3000, 21)
    const unit = prose(1437, 22)
    const text = pre + unit.repeat(8)
    expect(loopOnset(text)).toBe(pre.length)
    // cut mid-copy (the stream stops wherever the detector fired)
    expect(loopOnset(text.slice(0, pre.length + unit.length * 3 + 700))).toBe(pre.length)
  })

  test("an earlier copy that differs slightly is cut too", () => {
    const pre = prose(2000, 44)
    const unit = prose(1200, 45)
    const jittered = unit.slice(0, 600) + "X" + unit.slice(601)
    // the jittered copy in the middle, and as the FIRST copy
    expect(loopOnset(pre + unit + jittered + unit.repeat(3))).toBe(pre.length)
    expect(loopOnset(pre + jittered + unit.repeat(5))).toBe(pre.length)
    // an inserted word in the first copy (copy lengths differ)
    const inserted = unit.slice(0, 400) + "really " + unit.slice(400)
    expect(loopOnset(pre + inserted + unit.repeat(5))).toBe(pre.length)
  })

  test("a partial first copy (the loop starts mid-unit) is cut", () => {
    const pre = prose(2000, 46)
    const unit = prose(1200, 47)
    expect(loopOnset(pre + unit.slice(700) + unit.repeat(5))).toBe(pre.length)
    const jittered = unit.slice(0, 900) + "Y" + unit.slice(901)
    expect(loopOnset(pre + jittered.slice(500) + unit.repeat(5))).toBe(pre.length)
  })

  test("the split moves past a shared line ending, never into words or into the loop", () => {
    const head = "Plan: add the flag and one test.\n"
    const line = "Wait, let me re-check that parse_args shifts after every flag before I edit.\n"
    expect(loopOnset(head + line.repeat(20))).toBe(head.length)
    // already at a line start: a short first line of the unit is not skipped
    const unit = "Wait.\n" + prose(400, 48) + "\n"
    const pre = prose(500, 49) + "\n"
    expect(loopOnset(pre + unit.repeat(10))).toBe(pre.length)
  })

  test("non-repeating text and two near-copies are left alone", () => {
    expect(loopKeep(cleanText)).toBe(cleanText.length)
    const draft = prose(1500, 46)
    const body = prose(800, 47) + draft
    expect(loopKeep(body)).toBe(body.length)
  })
})

describe("loop nudge carries ONLY the pre-loop work (LD-05c/d)", () => {
  const pre = prose(3000, 41)
  const unit = prose(1437, 42)

  test("parts: pre-loop work only", () => {
    const parts = loopNudgeParts(pre + unit.repeat(9))
    expect(parts.preLoop).toBe(pre)
    expect(parts.keep).toBe(pre.length)
    expect(parts).not.toHaveProperty("repeated")
  })

  test("text: wraps the pre-loop work, contains no copy of the loop, ends with the act instruction", () => {
    const stream = pre + unit.repeat(9)
    const { text, elided } = loopNudgeText(loopNudgeParts(stream))
    expect(elided).toBe(0)
    expect(text.startsWith(REASONING_LOOP_NUDGE)).toBe(true)
    expect(text).toContain("Here is the work you produced before the loop started:")
    expect(text).toContain(`<work-before-loop>\n${pre}\n</work-before-loop>`)
    expect(text).not.toContain("<repeated-once>")
    // no part of any copy: not even 64 chars of the unit
    for (let at = 0; at + 64 <= unit.length; at += 64) expect(text).not.toContain(unit.slice(at, at + 64))
    expect(text.trimEnd().endsWith("continue the task from here with the next concrete step (make the tool call / write the answer).")).toBe(true)
  })

  test("text: a loop from the first char says plainly that there was no pre-loop work", () => {
    const none = loopNudgeText(loopNudgeParts(unit.repeat(9)))
    expect(none.text).toContain("You produced no work before the loop started.")
    expect(none.text).not.toContain("<work-before-loop>")
    expect(none.text).not.toContain(unit.slice(0, 64))
  })

  test("text: huge pre-loop work keeps head + tail within the cap and states the elision", () => {
    const huge = prose(100_000, 43)
    const { text, elided } = loopNudgeText({ preLoop: huge })
    const room = LOOP_NUDGE_MAX_CHARS
    expect(elided).toBe(huge.length - room)
    expect(text).toContain(`[... ${elided} chars of this work elided from the middle ...]`)
    expect(text).toContain(huge.slice(0, Math.floor(room / 3)))
    expect(text).toContain(huge.slice(huge.length - (room - Math.floor(room / 3))))
    expect(text).not.toContain(huge.slice(0, Math.floor(room / 3) + 1))
    expect(text.length).toBeLessThan(LOOP_NUDGE_MAX_CHARS + 1_000)
  })
})
