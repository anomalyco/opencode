import { describe, expect, test } from "bun:test"
import { classify, shouldRun, deriveGateInputs } from "../../src/core/gate"
import type { NMessage } from "../../src/core/types"
import fixture from "../fixtures/gate/replay-20-turns.json"

function msg(id: string, role: "user" | "assistant", text: string, over: Partial<NMessage> = {}): NMessage {
  return { id, role, parts: [{ type: "text", text }], createdAt: 0, ...over }
}

describe("classify — the 12 validated rules", () => {
  test("R1 correction", () => {
    for (const text of [
      "I changed my mind: use SQLite instead of PostgreSQL.",
      "Scratch that, keep the API as is.",
      "Actually, let's revert the rename.",
      "That's the final decision.",
      "Override the previous choice.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("correction")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R1")).toBe(true)
    }
  })

  test("R2 standing instruction / durable preference", () => {
    for (const text of [
      "For this project, always use TypeScript instead of JavaScript.",
      "Never introduce dependencies without discussing them with me first.",
      "Remember that I prefer functional programming.",
      "Never deploy on Fridays from now on.",
      "House rule: ask me first before pushing.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("standing")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R2")).toBe(true)
    }
  })

  test("R3 open item", () => {
    for (const text of [
      "We still need to add tests for timeout handling.",
      "The implementation is not finished.",
      "TODO: wire up the retry path.",
      "The remaining work is the migration script.",
      "I'm blocked on the credentials.",
      "Next step: benchmark the new implementation.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("open_item")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R3")).toBe(true)
    }
  })

  test("R4 completion / verification / result", () => {
    for (const text of [
      "The benchmark completed.",
      "The implementation and tests are complete. All tests pass.",
      "Its result was 1,250 requests per second.",
      "The migration succeeded.",
      "95th-percentile latency is 42 ms.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("completion")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R4")).toBe(true)
    }
  })

  test("R3b negation guard: negated completion is an open item, not an outcome", () => {
    const c = classify("The migration has not been completed.")
    expect(c.cls).toBe("open_item")
    expect(c.decision).toBe("EXTRACT")
    expect(c.urgent).toBe(true)
    expect(c.rule.startsWith("R3b")).toBe(true)
  })

  test("R5 decision", () => {
    for (const text of [
      "We decided to use PostgreSQL as the primary database.",
      "We agreed on the event-driven design.",
      "We settled on SQLite.",
      "We chose the simpler option.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("decision")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R5")).toBe(true)
    }
  })

  test("R6 constraint", () => {
    for (const text of [
      "The API must remain backward compatible with version 1.",
      "The maximum number of retries must be three.",
      "Latency has to stay under 100 ms.",
      "Use at most 3 retries.",
      "We need at least two replicas.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("constraint")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R6")).toBe(true)
    }
  })

  test("R7 task assignment", () => {
    for (const text of [
      "Implement a retry mechanism with exponential backoff.",
      "Add tests for the timeout path.",
      "Fix the flaky migration test.",
      "Set up the benchmark harness.",
      "Integrate the payments provider.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("task")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R7")).toBe(true)
    }
  })

  test("R8 process start → DEFER", () => {
    for (const text of [
      "I started a background process to benchmark the new implementation. It is still running.",
      "Started the export job in the background.",
      "The deploy is still running.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("process_start")
      expect(c.decision).toBe("DEFER")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R8")).toBe(true)
    }
  })

  test("R8 defers only without a completion marker (R4 checked first)", () => {
    const c = classify("The background benchmark I started earlier has completed.")
    expect(c.cls).toBe("completion")
    expect(c.decision).toBe("EXTRACT")
  })

  test("R9 closure / acknowledgement (anchored: whole message must be an ack)", () => {
    for (const text of ["Thanks, that helps.", "Understood.", "Got it.", "OK", "Sounds good.", "Noted."]) {
      const c = classify(text)
      expect(c.cls).toBe("closure")
      expect(c.decision).toBe("SKIP")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R9")).toBe(true)
    }
  })

  test("R9 does not swallow substantive messages that merely start with thanks", () => {
    const c = classify("Thanks — but the build is still failing, we must fix it.")
    expect(c.decision).not.toBe("SKIP")
  })

  test("R10 question", () => {
    for (const text of [
      "What is the difference between Python lists and tuples?",
      "Which one is mutable?",
      "Can you explain list comprehensions?",
      "How does enumerate work?",
      "Is the server up?",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("question")
      expect(c.decision).toBe("SKIP")
      expect(c.rule.startsWith("R10")).toBe(true)
    }
  })

  test("R11 example request", () => {
    for (const text of ["Give me a simple example of tuple unpacking.", "Show me a sample.", "Got a snippet for that.", "Please demo it."]) {
      const c = classify(text)
      expect(c.cls).toBe("example")
      expect(c.decision).toBe("SKIP")
      expect(c.rule.startsWith("R11")).toBe(true)
    }
  })

  test("R12 default: unmatched → EXTRACT (recall-first)", () => {
    for (const text of ["Use SQLite instead.", "The tests are failing.", "The deploy window moved to Tuesday.", "Proceed."]) {
      const c = classify(text)
      expect(c.cls).toBe("other")
      expect(c.decision).toBe("EXTRACT")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R12")).toBe(true)
    }
  })

  test("short but meaningful messages are never SKIP'd for being short", () => {
    // every example from the task brief classifies as EXTRACT or DEFER, never SKIP
    for (const text of [
      "Use SQLite instead.",
      "That's the final decision.",
      "Never introduce dependencies without asking me.",
      "The tests are failing.",
      "The benchmark is complete.",
    ]) {
      expect(classify(text).decision).not.toBe("SKIP")
    }
  })

  test("deterministic across repeated executions", () => {
    const texts = [...fixture.messages, "Use SQLite instead.", "ok"]
    for (const text of texts) {
      const first = classify(text)
      for (let i = 0; i < 100; i++) {
        expect(classify(text)).toEqual(first)
      }
    }
  })
})

describe("shouldRun — the validated scheduling policy", () => {
  test("SKIP and DEFER never run", () => {
    expect(shouldRun("question", "SKIP", false, 100, false).run).toBe(false)
    expect(shouldRun("process_start", "DEFER", false, 100, false).run).toBe(false)
  })

  test("completion always runs, even right after a run", () => {
    const s = shouldRun("completion", "EXTRACT", true, 1, true)
    expect(s.run).toBe(true)
    expect(s.reason).toContain("completion")
  })

  test("≥2 turns since last run → run", () => {
    const s = shouldRun("constraint", "EXTRACT", false, 2, false)
    expect(s.run).toBe(true)
    expect(s.reason).toContain("2")
  })

  test("urgent right after a run coalesces (previous turn ran)", () => {
    const s = shouldRun("correction", "EXTRACT", true, 1, true)
    expect(s.run).toBe(false)
    expect(s.reason).toContain("coalesced")
  })

  test("urgent with a gap (previous turn did not run) runs immediately", () => {
    const s = shouldRun("correction", "EXTRACT", true, 1, false)
    expect(s.run).toBe(true)
    expect(s.reason).toContain("urgent")
  })

  test("non-urgent candidate with counter 1 coalesces", () => {
    expect(shouldRun("decision", "EXTRACT", false, 1, true).run).toBe(false)
  })
})

describe("deriveGateInputs — pending turns derived from the existing cursor", () => {
  const messages = fixture.messages.flatMap((text, i) => [
    msg(`u${i + 1}`, "user", text),
    msg(`a${i + 1}`, "assistant", `reply ${i + 1}`),
  ])

  test("no cursor (no run yet) → every real user turn is pending, counter ∞", () => {
    // Validated: "completed turns since the last run (∞ initially)" — the
    // first positive turn must run immediately instead of coalescing.
    const g = deriveGateInputs(messages, null)
    expect(g).not.toBeNull()
    expect(g!.counter).toBe(Number.POSITIVE_INFINITY)
    expect(g!.lastRunWasPreviousTurn).toBe(false)
    expect(g!.userText).toBe(fixture.messages[19])
    expect(g!.pendingUserIds).toEqual(Array.from({ length: 20 }, (_, i) => `u${i + 1}`))
    expect(g!.pendingMessages).toBe(40)
    expect(g!.pendingTokens).toBeGreaterThan(0)
  })

  test("no cursor with a single pending turn still counts as ∞, not 1", () => {
    const g = deriveGateInputs(messages.slice(0, 2), null)
    expect(g!.counter).toBe(Number.POSITIVE_INFINITY)
    expect(g!.lastRunWasPreviousTurn).toBe(false)
  })

  test("cursor after turn 11 → turns 12..20 pending", () => {
    const g = deriveGateInputs(messages, "a11")
    expect(g!.counter).toBe(9)
    expect(g!.userText).toBe(fixture.messages[19])
    expect(g!.pendingUserIds).toEqual(Array.from({ length: 9 }, (_, i) => `u${12 + i}`))
  })

  test("cursor at the last assistant → nothing pending (duplicate idle)", () => {
    expect(deriveGateInputs(messages, "a20")).toBeNull()
  })

  test("unknown cursor id → treated as nothing processed (conservative)", () => {
    const g = deriveGateInputs(messages, "ghost-id")
    expect(g!.counter).toBe(20)
  })

  test("synthetic, wake, and rollover-context messages never count as turns", () => {
    const mixed = [
      msg("u1", "user", "We decided to use PostgreSQL."),
      msg("a1", "assistant", "ok"),
      msg("syn1", "user", "<rollover_context epoch='1'>…</rollover_context>", { synthetic: true }),
      msg("wake1", "user", "<shell id=\"sh_1\">background output</shell>"),
      msg("a2", "assistant", "done"),
    ]
    const g = deriveGateInputs(mixed, null)
    expect(g!.counter).toBe(Number.POSITIVE_INFINITY)
    expect(g!.pendingUserIds).toEqual(["u1"])
    expect(g!.userText).toBe("We decided to use PostgreSQL.")
  })

  test("empty-text user messages do not count", () => {
    const mixed = [msg("u1", "user", ""), msg("a1", "assistant", "ok")]
    expect(deriveGateInputs(mixed, null)).toBeNull()
  })
})

describe("classify — Turkish patterns", () => {
  test("R1 correction (tr)", () => {
    for (const text of [
      "Fikrimi değiştirdim: SQLite kullanacağız.",
      "Vazgeç, eski yöntemde kalalım.",
      "Bunun yerine cookie tabanlı auth yapalım.",
      "Kararımı değiştirdim, geri alalım.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("correction")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R1")).toBe(true)
      expect(c.matched).toBe("tr")
    }
  })

  test("R2 standing instruction (tr)", () => {
    for (const text of [
      "Bu projede her zaman TypeScript kullanacağız.",
      "Hiçbir zaman benimle görüşmeden bağımlılık ekleme.",
      "Bundan sonra commit öncesi testleri çalıştır.",
      "Tercihen fonksiyonel programlama kullanalım.",
      "Aklında kalsın: main'e direkt push yok.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("standing")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R2")).toBe(true)
      expect(c.matched).toBe("tr")
    }
  })

  test("R3 open item (tr)", () => {
    for (const text of [
      "Bitmedi; timeout testleri hâlâ gerekli.",
      "Migration script'i yazılacak.",
      "Credentials bekliyoruz, bloklandım.",
      "Sonraki adım: benchmark çıktısını yorumla.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("open_item")
      expect(c.urgent).toBe(true)
      expect(c.rule.startsWith("R3")).toBe(true)
      expect(c.matched).toBe("tr")
    }
  })

  test("R4 completion (tr) + negation guard", () => {
    const ok = classify("Benchmark tamamlandı: 1.250 rps, 42 ms p95.")
    expect(ok.cls).toBe("completion")
    expect(ok.urgent).toBe(true)
    expect(ok.rule.startsWith("R4")).toBe(true)
    expect(ok.matched).toBe("tr")
    const ok2 = classify("Implementasyon ve testler tamam, hepsi geçti.")
    expect(ok2.cls).toBe("completion")
    // R3b isolation: "başarısız" trips the R4 pattern (testler + başar…) but
    // NEGATED_TR flips it to open_item. ("bitmedi" alone is caught by R3
    // directly — first-match precedence — so it cannot exercise R3b.)
    const negated = classify("Testler başarısız.")
    expect(negated.cls).toBe("open_item")
    expect(negated.rule.startsWith("R3b")).toBe(true)
    expect(negated.matched).toBe("tr")
    // precedence pin: completion word wins over question form (English parallel:
    // "Is it finished?" → R4, not R10)
    expect(classify("Bitti mi?").cls).toBe("completion")
  })

  test("R5 decision (tr)", () => {
    const c = classify("Birincil veritabanı olarak PostgreSQL kullanacağız.")
    expect(c.cls).toBe("decision")
    expect(c.urgent).toBe(false)
    expect(c.rule.startsWith("R5")).toBe(true)
    expect(c.matched).toBe("tr")
  })

  test("R6 constraint (tr)", () => {
    const c = classify("Maksimum retry sayısı 3 olmalı.")
    expect(c.cls).toBe("constraint")
    expect(c.urgent).toBe(false)
    expect(c.rule.startsWith("R6")).toBe(true)
    expect(c.matched).toBe("tr")
  })

  test("R7 task (tr)", () => {
    for (const text of [
      "Retry mekanizmasını backoff ile ekle.",
      "README'yi güncelle.",
      "Test ortamını kuralım.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("task")
      expect(c.urgent).toBe(false)
      expect(c.rule.startsWith("R7")).toBe(true)
      expect(c.matched).toBe("tr")
    }
  })

  test("R8 process start (tr) → DEFER", () => {
    const c = classify("Benchmark süreci arka planda çalışıyor.")
    expect(c.cls).toBe("process_start")
    expect(c.decision).toBe("DEFER")
    expect(c.urgent).toBe(false)
    expect(c.rule.startsWith("R8")).toBe(true)
    expect(c.matched).toBe("tr")
  })

  test("R9 closure (tr) — anchored", () => {
    for (const text of ["Teşekkürler, yardımcı oldu.", "Anladım.", "Tamam.", "Sağ ol.", "Peki."]) {
      const c = classify(text)
      expect(c.cls).toBe("closure")
      expect(c.decision).toBe("SKIP")
      expect(c.matched).toBe("tr")
    }
  })

  test("R10 question (tr)", () => {
    // "?" sonu evrenseldir ve İngilizce desenin içinde yaşar → matched "en"
    // (etiket "EN desen seti" demek, "İngilizce dil" değil — bkz. gate.ts header notu).
    for (const text of [
      "Python listeleri ile demetler (tuple) arasındaki fark nedir?",
      "List comprehension'ları açıklar mısın?",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("question")
      expect(c.decision).toBe("SKIP")
    }
    for (const text of ["Hangisi değiştirilebilir?", "Ne zaman tamamlanacak?"]) {
      const c = classify(text)
      expect(c.cls).toBe("question")
      expect(c.decision).toBe("SKIP")
      expect(c.matched).toBe("tr")
    }
  })

  test("R10 TR patterns never match English text (review regression)", () => {
    // Review 2026-11-17 (Important): boundsuz `hang[ıi][a-z…]*` İngilizce
    // "Hanging…" ile, `kim(?![TW])` cümle başındaki İngilizce "Kim" adıyla
    // eşleşip sessiz SKIP üretiyordu (eski gate: R12 EXTRACT → içerik kaybı).
    // Üçü de artık R12'ye düşer: EXTRACT yanlışı yalnız maliyettir, SKIP kayıptır.
    for (const text of [
      "Hanging indents look wrong in the TUI",
      "Hangin' out with the team today",
      "Kim left the company.",
    ]) {
      const c = classify(text)
      expect(c.cls).toBe("other")
      expect(c.decision).toBe("EXTRACT")
      expect(c.matched).toBe("default")
    }
    // Takasın belgelenmesi: "kim?" evrensel "?" sondası üzerinden SKIP olmayı
    // sürdürür (matched=en); yalnız "?siz" kim soruları R12'ye düşer.
    const bare = classify("kim?")
    expect(bare.cls).toBe("question")
    expect(bare.decision).toBe("SKIP")
    expect(bare.matched).toBe("en")
    // Türkçe soru formları SKIP'i korur (hangi + iyelik eki, ?siz nas[ıi]l)
    for (const text of ["Hangisi değiştirilebilir?", "Hangi dosya?", "Nasıl çalıştırırım?"]) {
      const c = classify(text)
      expect(c.cls).toBe("question")
      expect(c.decision).toBe("SKIP")
      expect(c.matched).toBe("tr")
    }
  })

  test("R11 example (tr)", () => {
    const c = classify("Bana basit bir tuple unpacking örneği ver.")
    expect(c.cls).toBe("example")
    expect(c.decision).toBe("SKIP")
    expect(c.matched).toBe("tr")
  })
})

describe("classify — matched field on English input", () => {
  test("English rules report matched: en", () => {
    expect(classify("I changed my mind: use SQLite.").matched).toBe("en")
    expect(classify("What is a tuple?").matched).toBe("en")
    expect(classify("Thanks, that helps.").matched).toBe("en")
  })
  test("Unmatched input reports matched: default", () => {
    const c = classify("xyzzy plugh")
    expect(c.cls).toBe("other")
    expect(c.matched).toBe("default")
  })
})

describe("classify — Review Focus inputs", () => {
  test("mixed language: English word inside Turkish sentence keeps rule precedence", () => {
    const c = classify("TODO: auth testlerini hâlâ yazmadım.")
    expect(c.cls).toBe("open_item")
    expect(c.rule.startsWith("R3")).toBe(true)
  })
  test("diacritics-less Turkish: bracket patterns cover ASCII variants", () => {
    expect(classify("tesekkurler").decision).toBe("SKIP")
    expect(classify("bitmedi, testler eksik").cls).toBe("open_item")
    expect(classify("hala calisiyor").decision).toBe("DEFER")
  })
  test("emoji-tailed closure is not SKIP (safe direction)", () => {
    expect(classify("Tamam! 👍").decision).toBe("EXTRACT")
    expect(classify("Tamam!").decision).toBe("SKIP")
  })
  test("very short messages", () => {
    expect(classify("tamam").decision).toBe("SKIP")
    expect(classify("ok").decision).toBe("SKIP")
    expect(classify("?").decision).toBe("SKIP")
  })
  test("multi-line closure with content is not SKIP", () => {
    expect(classify("Tamam,\nşunu da ekle").decision).toBe("EXTRACT")
  })
})
