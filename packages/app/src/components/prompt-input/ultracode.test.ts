import { describe, expect, test } from "bun:test"
import {
  budgetDirectiveText,
  buildBudgetPart,
  buildUltracodeParts,
  detectBudgetDirective,
  detectUltracodeKeyword,
  stripBudgetDirective,
  stripUltracodeKeyword,
  strongestReasoningVariant,
  systemReminder,
  ultracodeToggle,
  ULTRACODE_PROMPT_DIRECTIVE,
} from "./ultracode"

describe("ultracode keyword", () => {
  test("detects standalone keyword and reports span", () => {
    expect(detectUltracodeKeyword("please ultracode this")).toEqual({ index: 7, length: 9 })
    expect(detectUltracodeKeyword("ULTRACODE: audit")).toEqual({ index: 0, length: 9 })
  })
  test("ignores keyword glued to word chars", () => {
    expect(detectUltracodeKeyword("ultracodex")).toBeUndefined()
    expect(detectUltracodeKeyword("ultracode2")).toBeUndefined()
    expect(detectUltracodeKeyword("ultracode_mode")).toBeUndefined()
    expect(detectUltracodeKeyword("öultracode")).toBeUndefined()
  })
  test("strips keyword and collapses leftover whitespace/colon", () => {
    expect(stripUltracodeKeyword("ultracode: audit the repo")).toBe("audit the repo")
    expect(stripUltracodeKeyword("please ultracode this now")).toBe("please this now")
  })
  // Item 13: the session directive no longer exists client-side — the
  // /ultracode toggle persists session.metadata.ultracode and the server
  // carries the standing opt-in in the system prompt.
  test("the keyword directive is a non-empty constant", () => {
    expect(ULTRACODE_PROMPT_DIRECTIVE.length).toBeGreaterThan(0)
    // Item 3: hybrid-scout recommendation (kept word-identical with the TUI twin).
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("Discover the work list inline first")
  })
})

describe("systemReminder", () => {
  test("wraps text in the <system-reminder> tag", () => {
    expect(systemReminder("X")).toBe("<system-reminder>X</system-reminder>")
  })
  test("wrapped directives keep the original wording", () => {
    const wrapped = systemReminder(ULTRACODE_PROMPT_DIRECTIVE)
    expect(wrapped).toContain(ULTRACODE_PROMPT_DIRECTIVE)
    expect(wrapped.startsWith("<system-reminder>")).toBe(true)
    expect(wrapped.endsWith("</system-reminder>")).toBe(true)
  })
})

describe("buildUltracodeParts", () => {
  test("prepends the keyword directive and strips the keyword", () => {
    const out = buildUltracodeParts({ text: "ultracode fix bug", keywordEnabled: true })
    expect(out.directives).toEqual([ULTRACODE_PROMPT_DIRECTIVE])
    expect(out.text).toBe("fix bug")
  })
  test("no directives without a keyword", () => {
    expect(buildUltracodeParts({ text: "fix bug", keywordEnabled: true })).toEqual({
      directives: [],
      text: "fix bug",
    })
  })
  test("keyword directive suppressed when keywordEnabled is false", () => {
    const out = buildUltracodeParts({ text: "ultracode fix bug", keywordEnabled: false })
    expect(out.directives).toEqual([])
    expect(out.text).toBe("ultracode fix bug")
  })
})

describe("budget directive", () => {
  test("detects standalone +$ amounts with span and value", () => {
    expect(detectBudgetDirective("+$5")).toEqual({ index: 0, length: 3, usd: 5 })
    expect(detectBudgetDirective("+$5.50")).toEqual({ index: 0, length: 6, usd: 5.5 })
    expect(detectBudgetDirective("mitten +$5 im Satz")).toEqual({ index: 7, length: 3, usd: 5 })
  })
  test("ignores glued or malformed forms", () => {
    expect(detectBudgetDirective("a+$5")).toBeUndefined()
    expect(detectBudgetDirective("+$5x")).toBeUndefined()
    expect(detectBudgetDirective("+5")).toBeUndefined()
    expect(detectBudgetDirective("5$")).toBeUndefined()
    expect(detectBudgetDirective("+$")).toBeUndefined()
    // No partial match either: the trailing-dot lookahead rejects "+$5.2".
    expect(detectBudgetDirective("+$5.2.3")).toBeUndefined()
  })
  test("strips every occurrence and collapses leftover whitespace", () => {
    expect(stripBudgetDirective("+$3 audit +$7 src/")).toBe("audit src/")
    expect(stripBudgetDirective("+$5: do x")).toBe("do x")
    expect(stripBudgetDirective("+$5")).toBe("")
  })
  test("budgetDirectiveText carries the amount", () => {
    expect(budgetDirectiveText(5)).toContain("$5")
    expect(budgetDirectiveText(5)).toContain("budget: 5")
  })
})

describe("buildBudgetPart", () => {
  test("returns directive + stripped text + usd when enabled", () => {
    const out = buildBudgetPart({ text: "+$5 do x", enabled: true })
    expect(out.directive).toBe(budgetDirectiveText(5))
    expect(out.text).toBe("do x")
    expect(out.usd).toBe(5)
  })
  test("enabled:false leaves the text untouched and adds no directive", () => {
    expect(buildBudgetPart({ text: "+$5 do x", enabled: false })).toEqual({ text: "+$5 do x" })
  })
  test("text without a directive passes through", () => {
    expect(buildBudgetPart({ text: "do x", enabled: true })).toEqual({ text: "do x" })
  })
  test("composes with the ultracode strip (ultracode first, budget second)", () => {
    const ultracode = buildUltracodeParts({ text: "ultracode +$5 audit src/", keywordEnabled: true })
    const budget = buildBudgetPart({ text: ultracode.text, enabled: true })
    expect(budget.text).toBe("audit src/")
    expect(budget.usd).toBe(5)
  })
})

describe("ultracodeToggle", () => {
  test("flips state and reports the labels for the resulting state", () => {
    const turningOn = ultracodeToggle(false)
    expect(turningOn.next).toBe(true)
    expect(turningOn.commandTitle).toBe("command.ultracode.disable")
    expect(turningOn.toast).toEqual({
      title: "toast.ultracode.on.title",
      description: "toast.ultracode.on.description",
    })

    const turningOff = ultracodeToggle(true)
    expect(turningOff.next).toBe(false)
    expect(turningOff.commandTitle).toBe("command.ultracode.enable")
    expect(turningOff.toast).toEqual({
      title: "toast.ultracode.off.title",
      description: "toast.ultracode.off.description",
    })
  })
  test("a boost selects the boosted on-description", () => {
    expect(ultracodeToggle(false, "high").toast.description).toBe("toast.ultracode.on.descriptionBoosted")
  })
  test("a boost is ignored when turning off", () => {
    expect(ultracodeToggle(true, "high").toast.description).toBe("toast.ultracode.off.description")
  })
})

describe("strongestReasoningVariant", () => {
  test("prefers a known high-effort name regardless of case or position", () => {
    expect(strongestReasoningVariant(["low", "medium", "high"])).toBe("high")
    expect(strongestReasoningVariant(["Max", "low"])).toBe("Max")
    // `preferred` order wins over list order: max beats high.
    expect(strongestReasoningVariant(["high", "max"])).toBe("max")
  })
  test("falls back to the last variant (providers order low → high)", () => {
    expect(strongestReasoningVariant(["mini", "turbo"])).toBe("turbo")
  })
  test("returns undefined for a model without variants", () => {
    expect(strongestReasoningVariant([])).toBeUndefined()
  })
})
