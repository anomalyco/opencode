import { describe, expect, it } from "bun:test"
import {
  budgetDirectiveText,
  detectBudgetDirective,
  detectUltracodeKeyword,
  stripBudgetDirective,
  stripUltracodeKeyword,
  ultracodeReminder,
  ULTRACODE_PROMPT_DIRECTIVE,
} from "../../../../src/component/prompt/ultracode"

describe("ultracode keyword", () => {
  it("erkennt das Keyword als eigenständiges Token, case-insensitive", () => {
    expect(detectUltracodeKeyword("ultracode: audit src/")?.index).toBe(0)
    expect(detectUltracodeKeyword("bitte ULTRACODE nutzen")?.index).toBe(6)
    expect(detectUltracodeKeyword("kein ultracodex hier")).toBeUndefined()
    expect(detectUltracodeKeyword("xultracode")).toBeUndefined()
  })

  it("liefert Länge fürs Highlight", () => {
    const hit = detectUltracodeKeyword("run ultracode now")
    expect(hit && { index: hit.index, length: hit.length }).toEqual({ index: 4, length: 9 })
  })

  it("stripUltracodeKeyword entfernt Token + Doppel-Spaces + führenden Doppelpunkt", () => {
    expect(stripUltracodeKeyword("ultracode: audit src/")).toBe("audit src/")
    expect(stripUltracodeKeyword("bitte ultracode  nutzen")).toBe("bitte nutzen")
  })

  // Item 13: die Session-Direktive existiert klientenseitig nicht mehr — der
  // /ultracode-Toggle persistiert session.metadata.ultracode, der Server trägt
  // das standing opt-in im Systemprompt. Nur die Keyword-Direktive bleibt.
  it("Direktive nennt workflow-Tool und create", () => {
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("workflow")
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("create")
  })

  // Edge cases beyond the mandated spec. Boundaries follow identifier rules:
  // a neighbouring letter, digit, or underscore prevents a match.
  it("matcht nur ganze Wörter und respektiert Wortgrenzen mit Interpunktion", () => {
    expect(detectUltracodeKeyword("(ultracode)")?.index).toBe(1)
    expect(detectUltracodeKeyword("foo-ultracode")?.index).toBe(4)
    expect(detectUltracodeKeyword("ultracode_mode")).toBeUndefined()
    expect(detectUltracodeKeyword("ultracode2")).toBeUndefined()
    expect(detectUltracodeKeyword("ultracode")?.index).toBe(0)
  })

  // Unicode-Wortgrenzen: `\b` ist ASCII-only und würde "ultracodeö" fälschlich als
  // Treffer werten. Mit Unicode-Lookarounds zählen auch Nicht-ASCII-Buchstaben als
  // Wortzeichen, also blockieren sie den Match links wie rechts.
  it("respektiert Unicode-Buchstaben an der Wortgrenze", () => {
    expect(detectUltracodeKeyword("ultracodeö")).toBeUndefined()
    expect(detectUltracodeKeyword("öultracode")).toBeUndefined()
    expect(detectUltracodeKeyword("ödann ultracode jetzt")?.index).toBe(6)
  })

  it("liefert das erste Vorkommen", () => {
    const hit = detectUltracodeKeyword("ultracode then ultracode again")
    expect(hit?.index).toBe(0)
  })

  it("ohne Keyword kommt undefined zurück", () => {
    expect(detectUltracodeKeyword("just a normal prompt")).toBeUndefined()
    expect(detectUltracodeKeyword("")).toBeUndefined()
  })

  it("stripUltracodeKeyword entfernt das Keyword mitten im Text und säubert Spaces", () => {
    expect(stripUltracodeKeyword("run ultracode now")).toBe("run now")
    expect(stripUltracodeKeyword("ULTRACODE audit")).toBe("audit")
  })

  it("stripUltracodeKeyword lässt Text ohne Keyword unverändert (nur getrimmt)", () => {
    expect(stripUltracodeKeyword("just a normal prompt")).toBe("just a normal prompt")
  })

  it("stripUltracodeKeyword entfernt das Keyword auch wenn es alleine steht", () => {
    expect(stripUltracodeKeyword("ultracode")).toBe("")
    expect(stripUltracodeKeyword("ultracode  ")).toBe("")
  })

  it("Direktive transportiert die volle opt-in Semantik", () => {
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("ultracode")
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("start")
    // Item 3: Hybrid-Scout-Empfehlung — Arbeitsliste inline entdecken, dann fan-out.
    expect(ULTRACODE_PROMPT_DIRECTIVE).toContain("Discover the work list inline first")
  })

  it("ultracodeReminder wrappt in <system-reminder>", () => {
    expect(ultracodeReminder("X")).toBe("<system-reminder>X</system-reminder>")
  })

  it("gewrappte Direktiven enthalten den Originalwortlaut", () => {
    for (const directive of [ULTRACODE_PROMPT_DIRECTIVE]) {
      const wrapped = ultracodeReminder(directive)
      expect(wrapped).toContain(directive)
      expect(wrapped.startsWith("<system-reminder>")).toBeTrue()
      expect(wrapped.endsWith("</system-reminder>")).toBeTrue()
    }
  })
})

describe("budget directive", () => {
  it("matcht '+$5' als eigenständiges Token mit index/length/value/unit", () => {
    expect(detectBudgetDirective("+$5")).toEqual({ index: 0, length: 3, value: 5, unit: "usd" })
    expect(detectBudgetDirective("audit +$5 src/")).toEqual({ index: 6, length: 3, value: 5, unit: "usd" })
  })

  it("matcht Dezimalwerte wie '+$0.50'", () => {
    expect(detectBudgetDirective("+$0.50")).toEqual({ index: 0, length: 6, value: 0.5, unit: "usd" })
  })

  it("matcht in Klammern und akzeptiert '+$0'", () => {
    expect(detectBudgetDirective("(+$5)")?.index).toBe(1)
    expect(detectBudgetDirective("+$0")?.value).toBe(0)
  })

  it("matcht nicht, wenn das Token nicht alleine steht", () => {
    expect(detectBudgetDirective("x+$5")).toBeUndefined()
    expect(detectBudgetDirective("+$5x")).toBeUndefined()
    expect(detectBudgetDirective("+5")).toBeUndefined()
    expect(detectBudgetDirective("+$")).toBeUndefined()
  })

  // Teilmatch-Verhalten dokumentiert: '+$5.5.5' liefert KEINEN Teilmatch '+$5.5'
  // — der Punkt im Lookahead verwirft jede kürzere Variante, also gar kein Treffer.
  it("'+$5.5.5' matcht überhaupt nicht (kein Teilmatch)", () => {
    expect(detectBudgetDirective("+$5.5.5")).toBeUndefined()
  })

  it("liefert das erste Vorkommen bei mehreren Direktiven", () => {
    const hit = detectBudgetDirective("+$3 dann +$7")
    expect(hit?.index).toBe(0)
    expect(hit?.value).toBe(3)
  })

  it("ohne Direktive kommt undefined zurück", () => {
    expect(detectBudgetDirective("just a normal prompt")).toBeUndefined()
    expect(detectBudgetDirective("")).toBeUndefined()
  })

  it("stripBudgetDirective entfernt alle Vorkommen und kollabiert Whitespace", () => {
    expect(stripBudgetDirective("+$3 audit +$7 src/")).toBe("audit src/")
    expect(stripBudgetDirective("+$5")).toBe("")
    // Parität zur stripUltracodeKeyword-Pipeline: hängende Interpunktion wird
    // angeklebt, führender Doppelpunkt/Whitespace entfernt, Ergebnis getrimmt.
    expect(stripBudgetDirective("+$5: audit")).toBe("audit")
    expect(stripBudgetDirective("audit +$5 , fertig")).toBe("audit, fertig")
  })

  it("Kombination: 'ultracode +$5 audit src/' nach beiden Strips = 'audit src/'", () => {
    expect(stripBudgetDirective(stripUltracodeKeyword("ultracode +$5 audit src/"))).toBe("audit src/")
  })

  it("budgetDirectiveText nennt budget, den Betrag und ctx.budget.remaining", () => {
    const text = budgetDirectiveText(5)
    expect(text).toContain("budget")
    expect(text).toContain("$5")
    expect(text).toContain("ctx.budget.remaining")
  })

  it("budgetDirectiveText im Reminder-Wrapper bleibt wortgleich enthalten", () => {
    const wrapped = ultracodeReminder(budgetDirectiveText(3))
    expect(wrapped).toContain(budgetDirectiveText(3))
    expect(wrapped.startsWith("<system-reminder>")).toBeTrue()
    expect(wrapped.endsWith("</system-reminder>")).toBeTrue()
  })
})
