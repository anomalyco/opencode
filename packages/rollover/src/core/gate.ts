/**
 * Deterministic extraction gate (zero LLM calls).
 *
 * Ported from the validated offline experiment
 * `experiments/2026-11-16-extraction-gate/gate/gate.mts` (2026-11-16: 20 → 7
 * extraction calls, −65%, 32/32 meaningful records content-covered). The
 * ENGLISH patterns, rule order, precedence, negation guard, and scheduling
 * policy stay byte-identical to that reference; the experiment replay test
 * (`tests/integration/gate-replay.test.ts`) enforces it. Turkish patterns
 * (2026-11-17 design: docs/superpowers/specs/2026-11-17-gate-turkish-patterns-design.md)
 * are additive and contain Turkish-only characters/words only, so an English
 * message can never match a TR pattern and the validated English
 * classification is structurally unchanged (review-hardened same day: R10's
 * `hangi` is right-bounded and `kim` is excluded — English "Hanging…" / "Kim …"
 * fall to R12; see the R10 note below). Note: universal patterns (the "?"
 * ending) live inside the EN pattern set — a Turkish message matched by them
 * reports `matched: "en"`, which means "matched the EN pattern set", not
 * "English language". Known limitation: uppercase İ (U+0130) input falls to
 * R12 (EXTRACT; recall-first, never lossy).
 *
 * Two pure functions:
 *   1. classify(userText)        — first-match regex rules over the user message text.
 *   2. shouldRun(...)            — scheduling policy at the idle hook.
 * Plus deriveGateInputs, which derives the pending-turn state (turns since the
 * last run) from the EXISTING extraction cursor — the gate owns no persistent
 * state of its own, so restarts and duplicate idle events are safe by
 * construction.
 */
import type { NMessage } from "./types"
import { hasTextPart, isRealUserMessage } from "./view"
import { estimateMessageTokens } from "./tokens"

export type GateClass =
  | "correction"
  | "standing"
  | "open_item"
  | "completion"
  | "decision"
  | "constraint"
  | "task"
  | "process_start"
  | "closure"
  | "question"
  | "example"
  | "other"

export type GateDecision = "EXTRACT" | "SKIP" | "DEFER"

export interface GateClassification {
  cls: GateClass
  decision: GateDecision
  urgent: boolean
  rule: string
  /** Which pattern set matched: "en" (English set), "tr" (Turkish set), "default" (R12). */
  matched: "en" | "tr" | "default"
}

interface GateRule {
  cls: GateClass
  decision: GateDecision
  urgent: boolean
  rule: string
  /** Tried in order; the first matching pattern decides `matched`. */
  patterns: Array<{ lang: "en" | "tr"; re: RegExp }>
}

// Negated completion guard: "not finished/done/complete" is an open item, not an outcome.
const NEGATED_DONE = /\b(not|isn'?t|is not|aren'?t|aren not|won'?t|yet to be)\s+(been\s+)?(completed?|finished|done)\b/i

// Turkish negation guard: negation is an infix (bit-me-di); "not finished /
// did not pass / failed / is not running" is an open item, not an outcome.
const NEGATED_TR = /(bitmedi|tamamlanmad[ıi]|ge[çc]medi|ba[şs]ar[ıi]s[ıi]z|[çc]al[ıi][şs]m[ıi]yor|hata (verdi|ald[ıi]))/i

// Turkish patterns (design 2026-11-17-gate-turkish-patterns-design.md §2).
// Turkish-only characters/words only: borrowed words spelled identically in
// English (maximum, todo, p95, demo, …) stay EN-only so an English message
// can never match a TR pattern.
//
// JS \b is ASCII-only: Turkish letters (ç ğ ı ö ş ü â) are non-word chars, so
// \b next to them never matches ("olmalı." has no boundary after ı). TR
// patterns use explicit Turkish-aware boundary lookarounds instead:
//   word(body)  — both sides bounded (exact-word semantics)
//   start(body) — left bounded only (Turkish suffixes welcome: vazgeçtim,
//                 bitmedik, olmalıdır all keep the stem's meaning)
const TW = "a-zçğıöşüâî0-9_"
const word = (body: string): RegExp => new RegExp(`(?<![${TW}])(?:${body})(?![${TW}])`, "i")
const start = (body: string): RegExp => new RegExp(`(?<![${TW}])(?:${body})`, "i")
const SUF = "[a-zçğıöşüâî]*"

const TR: Record<string, Array<{ lang: "tr"; re: RegExp }>> = {
  R1: [
    { lang: "tr", re: start(`fikr${SUF}\\s*de[ğg]i[şs]t`) },
    { lang: "tr", re: start("vazge[çc]") },
    { lang: "tr", re: start("geri al") },
    { lang: "tr", re: word("iptal") },
    { lang: "tr", re: start(`karar${SUF}\\s*de[ğg]i[şs]t`) },
    { lang: "tr", re: start("bo[şs] ver") },
    { lang: "tr", re: word("bunun yerine") },
    { lang: "tr", re: word("d[üu]zeltme") },
  ],
  R2: [
    { lang: "tr", re: word("her zaman") },
    { lang: "tr", re: word("asla") },
    { lang: "tr", re: word("hi[çc]bir zaman") },
    { lang: "tr", re: word("bundan sonra") },
    { lang: "tr", re: /bana sorma(?:dan|y)/i },
    { lang: "tr", re: /[öo]nce bana sor\b/i },
    { lang: "tr", re: /izin istemeden/i },
    { lang: "tr", re: /akl[ıi]nda (?:kals[ıi]n|tut)/i },
    { lang: "tr", re: word("unutma") },
    { lang: "tr", re: /tercih(?:en|\s+eder)/i },
    { lang: "tr", re: /[öo]ncelik ver/i },
    { lang: "tr", re: /\bkural(?:[ıi]m|ımız)?\s*:/i },
    { lang: "tr", re: word("bu projede") },
  ],
  R3: [
    { lang: "tr", re: start("bitmedi") },
    { lang: "tr", re: start("tamamlanmad[ıi]") },
    { lang: "tr", re: word("eksik") },
    { lang: "tr", re: /(?:gerekiyor|gerekli\b)/i },
    { lang: "tr", re: word("kald[ıi]") },
    { lang: "tr", re: /(?:yap|yaz|ekle|olu[şs]tur)[ıi]?lacak/i },
    { lang: "tr", re: /sonraki ad[ıi]m/i },
    { lang: "tr", re: /(?:blokland|tak[ıi]ld)[ıi]/i },
    { lang: "tr", re: /(?:sonu[çc]|[çc][ıi]kt[ıi]|cevap|onay)\s+bekliyor/i },
  ],
  // Bilinçli daraltma: çıplak `hâlâ`/`henüz`/`bekliyor` desenleri YOK — İngilizce
  // R3'ün "still need"/"waiting on" gibi bağlamlı desenlerinin karşılığı bağlamlı
  // çekirdeklerdir; geniş tek sözcük R8 DEFER'yi ("hâlâ çalışıyor") ve soruları yutar.
  R4: [
    { lang: "tr", re: /tamamland[ıi]/i },
    { lang: "tr", re: word("bitti") },
    { lang: "tr", re: word("bitirildi") },
    { lang: "tr", re: word("haz[ıi]r") },
    { lang: "tr", re: /testler?\s+(?:ge[çc]|ba[şs]ar)/i },
    { lang: "tr", re: /ba[şs]ar[ıi]l[ıi]/i },
    { lang: "tr", re: word("ge[çc]ti") },
    { lang: "tr", re: /sonu[çc]\s*:/i },
    { lang: "tr", re: /[öo]l[çc][üu]ld[üu]/i },
  ],
  R5: [
    { lang: "tr", re: /karar verd/i },
    { lang: "tr", re: word("anla[şs]t[ıi]k") },
    { lang: "tr", re: word("se[çc]t[ıi]k") },
    { lang: "tr", re: word("kullanaca[ğg][ıi]z") },
    { lang: "tr", re: /plan(?:[ıi]m[ıi]z)?\s*:/i },
    { lang: "tr", re: word("b[öo]yle yapaca[ğg][ıi]z") },
  ],
  R6: [
    { lang: "tr", re: word("olmal[ıi]") },
    { lang: "tr", re: word("zorunlu") },
    { lang: "tr", re: word("[şs]art") },
    { lang: "tr", re: word("en (?:az|fazla)") },
    { lang: "tr", re: /geriye d[öo]n[üu]k uyum/i },
    { lang: "tr", re: word("gereklilik") },
    { lang: "tr", re: word("k[ıi]s[ıi]t") },
  ],
  R7: [
    { lang: "tr", re: word("(?:ekle|yaz|olu[şs]tur|kur|d[üu]zelt|de[ğg]i[şs]tir|g[üu]ncelle|kald[ıi]r|sil|[çc]al[ıi][şs]t[ıi]r|ta[şs]ı|uygula|iyile[şs]tir|optimize et|refactor et|test et|kontrol et)") },
    { lang: "tr", re: word("(?:ekleyelim|yazal[ıi]m|yapal[ıi]m|olu[şs]tural[ıi]m|kural[ıi]m|g[üu]ncelleyelim|d[üu]zenleyelim|[çc]al[ıi][şs]t[ıi]ral[ıi]m|kald[ıi]ral[ıi]m|silelim|ta[şs][ıi]yal[ıi]m)") },
  ],
  R8: [
    { lang: "tr", re: start("ba[şs]latt[ıi](?:m|k)?") },
    { lang: "tr", re: /arka planda/i },
    { lang: "tr", re: word("[çc]al[ıi][şs][ıi]yor") },
    { lang: "tr", re: word("s[üu]r[üu]yor") },
    { lang: "tr", re: /devam ediyor\b/i },
  ],
  R9: [
    { lang: "tr", re: /^(te[şs]ekk[üu]r(?:ler| ederim)|sa[ğg] ?ol(?:un)?|eyvallah|tamam(?:d[ıi]r)?|anlad[ıi]m|anla[şs][ıi]ld[ıi]|oldu|harika|[sş][üu]per|m[üu]kemmel|peki|not ald[ıi]m|gayet iyi)\b[\s,.!]*(\s*(?:bu|o)?\s*(?:yard[ıi]mc[ıi] ol(?:d[uü])?|mant[ıi]kl[ıi]|[çc]al[ıi][şs][ıi]yor|anla[şs][ıi]l[ıi]r|net|old[uü]))?[\s,.!]*$/i },
  ],
  R10: [
    // Review sertleştirmesi (2026-11-17): (a) `hangi` sağ-bounded — boundsuz
    // `hang[ıi][a-z…]*` İngilizce "Hanging…" ile eşleşip sessiz SKIP üretiyordu;
    // ek grubu (ını/ini, sı/si) "Hangisi?" gibi ekli soru formlarını korur.
    // (b) `kim` ÇIKARILDI: cümle başındaki "Kim" İngilizce bir isimdir ve
    // boundary bunu çözemez ("Kim " → space lookahead'i geçer); bare-kim
    // anchor'ı da salt-Türkçe değişmezini bozar. "?" ile biten "kim?" zaten
    // evrensel EN deseninden SKIP olur; "?siz" kim soruları R12'ye düşer
    // (EXTRACT — yalnız maliyet, kayıp yok).
    { lang: "tr", re: new RegExp(`^(?:ne(?![${TW}])|neden(?![${TW}])|ni[çc]in(?![${TW}])|nas[ıi]l(?![${TW}])|hang[ıi](?:[ıi]n[ıi]|s[ıi])?(?![${TW}])|nerede(?![${TW}])|ka[çc](?![${TW}]))`, "i") },
    { lang: "tr", re: /m[ıiüu]\s*\?\s*$/i },
    { lang: "tr", re: new RegExp(`(?:abilir|ebilir)\\s+m[ıi](?:s[ıi]n|s[ıi]n[ıi]z)?(?![${TW}])`, "i") },
  ],
  R11: [
    { lang: "tr", re: start("[öo]rne[kğ](?:ler|in|ine|inde|im|i|ni|te|ten)?") },
    { lang: "tr", re: word("(?:misal|[şs]ablon)") },
  ],
  // Not: `örnek` sözcüğünde k→ğ yumuşaması (örneği/örneğin) desen içinde [kğ] ile
  // kapsanır; misal/şablon çıplak gövdeyle bırakıldı — ekli biçimleri R12'ye düşer
  // (EXTRACT, kayıp yok).
}

// First match wins. Order is the validated precedence: corrections, standing
// instructions, open items, and completions outrank generic decisions,
// constraints, and tasks; SKIP rules come last; unmatched falls to R12
// (EXTRACT — recall-first: unknown is never treated as unimportant).
// EN patterns are the byte-identical reference copy. Within a rule, TR
// patterns are tried first: they are Turkish-only, so a pure-English message
// can never match them (English classification is untouched), and mixed
// Turkish messages (with borrowed words like rps/p95/TODO) then label
// `matched: "tr"` truthfully.
const RULES: GateRule[] = [
  { cls: "correction", decision: "EXTRACT", urgent: true, rule: "R1 correction: changed my mind / final decision / revert / override",
    patterns: [
      ...TR.R1,
      { lang: "en", re: /\b(changed my mind|final decision|scratch that|correction|revert\w*|overrid\w*|walk (that|it) back|second thoughts?)\b/i },
    ] },
  { cls: "standing", decision: "EXTRACT", urgent: true, rule: "R2 standing instruction/preference: always use / never introduce / remember that / prefer / without discussing / for this project / from now on",
    patterns: [
      ...TR.R2,
      { lang: "en", re: /\b(always use|never (introduce|use|add|deploy|commit|push|touch)|remember that|(explicitly )?prefers?\b|without discussing|ask(ing)? me first|check with me|discuss\w* with me|for this project|house rule|standing (rule|instruction)|from now on)\b/i },
    ] },
  { cls: "open_item", decision: "EXTRACT", urgent: true, rule: "R3 open item: still need / not finished / todo / remaining / next step / blocked / waiting on",
    patterns: [
      ...TR.R3,
      { lang: "en", re: /\b(still need|needs? to be added|not finished|not complete|incomplete|unfinished|todo|to-?do\b|remaining work|next step|blocked|waiting on|open (question|item)|follow-?up)\b/i },
    ] },
  { cls: "completion", decision: "EXTRACT", urgent: true, rule: "R4 completion/verification/result: completed / finished / all tests pass / result was / p95 / requests per second (negation-guarded)",
    patterns: [
      ...TR.R4,
      { lang: "en", re: /\b(completed?|finished|all tests? pass|tests? pass\w*|result was|succeeded|successful|passed|p9[05]\b|percentile|requests per second|rps|measured)\b/i },
    ] },
  { cls: "decision", decision: "EXTRACT", urgent: false, rule: "R5 decision: we decided / agreed / chose / going with",
    patterns: [
      ...TR.R5,
      { lang: "en", re: /\b(we (decided|agreed|chose|settled|will use|are using|going with)|decided to|settled on)\b/i },
    ] },
  { cls: "constraint", decision: "EXTRACT", urgent: false, rule: "R6 constraint: must / has to / backward compatible / maximum / at most|least / no more than",
    patterns: [
      ...TR.R6,
      { lang: "en", re: /\b(must|has to|requirement|backward.?compat\w*|maximum\b|max\b|minimum\b|no more than|at most|at least)\b/i },
    ] },
  { cls: "task", decision: "EXTRACT", urgent: false, rule: "R7 task assignment: implement / add / build / create / write / fix / refactor / set up / integrate",
    patterns: [
      ...TR.R7,
      { lang: "en", re: /\b(implement|add|build|create|write|fix|refactor|optimi[sz]e|set up|integrate|migrate)\b/i },
    ] },
  { cls: "process_start", decision: "DEFER", urgent: false, rule: "R8 unresolved process: started a / still running / in progress / background process (no completion marker: R4 checked first)",
    patterns: [
      ...TR.R8,
      { lang: "en", re: /\b(started a|started the|is (still )?running|still running|in progress|background (process|job|task)|running in the background)\b/i },
    ] },
  { cls: "closure", decision: "SKIP", urgent: false, rule: "R9 closure/ack: thanks / understood / got it / ok … (no content markers matched above)",
    patterns: [
      ...TR.R9,
      { lang: "en", re: /^(thanks|thank you|ok|okay|understood|got it|gotcha|great|perfect|nice|cool|awesome|sounds good|alright|noted)\b[\s,.!]*(\s*(that|this)?\s*(helps?|makes sense|works|is clear|clear))?[\s,.!]*$/i },
    ] },
  { cls: "question", decision: "SKIP", urgent: false, rule: "R10 question: ends with '?' or interrogative opener",
    patterns: [
      ...TR.R10,
      { lang: "en", re: /\?\s*$|^(what|which|how|why|when|who|where|can you|could you|does|do you|is|are|explain|tell me|describe)\b/i },
    ] },
  { cls: "example", decision: "SKIP", urgent: false, rule: "R11 example request: example / sample / snippet / demo",
    patterns: [
      ...TR.R11,
      { lang: "en", re: /\b(example|sample|snippet|demo)\b/i },
    ] },
]

export function classify(text: string): GateClassification {
  for (const r of RULES) {
    const hit = r.patterns.find((p) => p.re.test(text))
    if (!hit) continue
    // negation guard: "not finished / not complete" is an open item even if R3 somehow missed
    if (r.cls === "completion" && (NEGATED_DONE.test(text) || NEGATED_TR.test(text))) {
      return { cls: "open_item", decision: "EXTRACT", urgent: true, rule: "R3b negated completion → open item", matched: hit.lang }
    }
    return { cls: r.cls, decision: r.decision, urgent: r.urgent, rule: r.rule, matched: hit.lang }
  }
  return { cls: "other", decision: "EXTRACT", urgent: false, rule: "R12 default: unmatched → EXTRACT (recall-first)", matched: "default" }
}

// ── Scheduling policy at the idle hook ────────────────────────────────────
// counter = completed turns since the last extraction run (∞ initially,
// derived from the extraction cursor — see deriveGateInputs).
// SKIP/DEFER never run. EXTRACT runs when the content is new and either
//   - the class is completion (terminal outcomes must land even as the
//     conversation's final message), or
//   - at least 2 turns have passed since the last run (staleness bound:
//     any positive message waits at most ~1 extra turn), or
//   - the class is urgent and the immediately-previous turn did not run
//     (corrections/instructions/open items get a run as soon as there is a
//     gap; consecutive urgents coalesce because each later run's delta
//     already contains the earlier one — buildDelta accumulates from the
//     cursor, so coalescing never drops content, it only batches it).

export function shouldRun(
  cls: GateClass,
  decision: GateDecision,
  urgent: boolean,
  counter: number,
  lastRunWasPreviousTurn: boolean,
): { run: boolean; reason: string } {
  if (decision === "SKIP") return { run: false, reason: "SKIP" }
  if (decision === "DEFER") return { run: false, reason: "DEFER (content rides in the next run's delta)" }
  if (cls === "completion") return { run: true, reason: "completion/verification → always run" }
  if (counter >= 2) return { run: true, reason: "≥2 turns since last run" }
  if (urgent && !lastRunWasPreviousTurn) return { run: true, reason: "urgent + previous turn did not run" }
  return { run: false, reason: "coalesced (positive, but last run was the previous turn)" }
}

// ── Pending-turn derivation (adapter-free; the cursor is the only state) ──

export interface GateInputs {
  /** Text of the most recent pending real user message — what classify() sees. */
  userText: string
  /** Real user messages after the cursor = completed turns since the last run. */
  counter: number
  /** True when exactly one turn is pending, i.e. the immediately-previous turn ran. */
  lastRunWasPreviousTurn: boolean
  pendingUserIds: string[]
  /** All messages (user + assistant) in the unprocessed span. */
  pendingMessages: number
  pendingTokens: number
}

/**
 * Derives the gate's scheduling inputs from the projected history and the
 * existing extraction cursor. Returns null when nothing is pending —
 * duplicate idle events and already-caught-up sessions are no-ops. An
 * unknown cursor id (e.g. after a swap reshaped the projection) counts
 * everything as pending: conservative, never lossy.
 */
export function deriveGateInputs(msgs: NMessage[], cursorId: string | null): GateInputs | null {
  const at = cursorId ? msgs.findIndex((m) => m.id === cursorId) + 1 : 0
  const safeStart = at < 0 ? 0 : at
  const pending = msgs.slice(safeStart)
  const pendingUsers = pending.filter((m) => isRealUserMessage(m) && hasTextPart(m))
  if (pendingUsers.length === 0) return null
  const last = pendingUsers[pendingUsers.length - 1]
  // Validated semantics: counter = completed turns since the last run, ∞
  // before the first run ever succeeds (any positive turn runs immediately).
  // Afterwards the run anchor is the cursor, and turns since the last run is
  // exactly the number of real user messages after it.
  const counter = cursorId === null ? Number.POSITIVE_INFINITY : pendingUsers.length
  return {
    userText: last.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"),
    counter,
    lastRunWasPreviousTurn: counter === 1,
    pendingUserIds: pendingUsers.map((m) => m.id),
    pendingMessages: pending.length,
    pendingTokens: pending.reduce((acc, m) => acc + estimateMessageTokens(m), 0),
  }
}
