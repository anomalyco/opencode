// wake.js v5 — trigger → curator analyzes → ready verdict only.
// Correct order (user directive): NOTHING enters the target chat until a
// curator finishes full analysis. The timer only starts analysis; the
// verdict is injected after, by a fresh curator session per wake.
// Mechanism (verified against core source, no core edits): plugin init
// `client` (session.create/messages/promptAsync/delete). Dies with the
// app process: app closed = no work, by construction.
// Guards: thresholds, cooldown, max wakes, backoff, blind window,
// eviction, terminal HIBERNATE, config validation, events log.
// Fallback: if curation fails at any step, the static nudge still fires.
import { promises as fs } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"

const MEMDIR = join(homedir(), ".config", "opencode", "memory")
const CONF = join(homedir(), ".config", "opencode", "wake.json")
const VAULT_AGENT = join(homedir(), ".config", "opencode", "curator", "agent.md")
const VAULT_FACT = join(homedir(), ".config", "opencode", "curator", "factcheck.md")
const PRESENCE_SH = join(homedir(), ".config", "opencode", "presence", "presence.sh")
// Defaults; wake.json (re-read every tick, no restart needed) overrides:
// Master + per-module toggles map 1:1 to future GUI switches.
const DEF = {
  enabled: (process.env.WAKE_ENABLED ?? "1") === "1",
  idle_ms: Number(process.env.WAKE_IDLE_MS ?? 10 * 60 * 1000),
  cooldown_ms: Number(process.env.WAKE_COOLDOWN_MS ?? 10 * 60 * 1000),
  max: Number(process.env.WAKE_MAX ?? 3),
  curation_timeout_ms: 10 * 60 * 1000,
  digest_messages: 40,
  model: null,
  presence_enabled: (process.env.WAKE_PRESENCE ?? "1") === "1",
  presence_away_ms: 5 * 60 * 1000,
  curator_enabled: (process.env.WAKE_CURATOR ?? "1") === "1",
  factcheck_enabled: (process.env.WAKE_FACTCHECK ?? "1") === "1",
  factcheck_timeout_ms: 5 * 60 * 1000,
  quiet_outside_tab: true,
}
const TICK_MS = 60 * 1000
const BACKOFF_CAP_MS = 60 * 60 * 1000
// Blind window after our own verdict: the woken agent's verification tools
// must not re-arm the watchdog, or wake→verify→wake loops forever.
const POST_WAKE_BLIND_MS = Number(process.env.WAKE_BLIND_MS ?? 3 * 60 * 1000)

async function conf() {
  const bad = (msg) => {
    logEvent({ type: "config_rejected", msg }).catch(() => {})
    return DEF
  }
  try {
    const raw = await fs.readFile(CONF, "utf8")
    const j = JSON.parse(raw)
    const c = {
      enabled: j.enabled ?? DEF.enabled,
      idle_ms: Number(j.idle_ms ?? DEF.idle_ms),
      cooldown_ms: Number(j.cooldown_ms ?? DEF.cooldown_ms),
      max: Number(j.max ?? DEF.max),
      curation_timeout_ms: Number(j.curation_timeout_ms ?? DEF.curation_timeout_ms),
      digest_messages: Number(j.digest_messages ?? DEF.digest_messages),
      model: j.model ?? DEF.model,
      presence_enabled: j.presence_enabled ?? DEF.presence_enabled,
      presence_away_ms: Number(j.presence_away_ms ?? DEF.presence_away_ms),
      curator_enabled: j.curator_enabled ?? DEF.curator_enabled,
      factcheck_enabled: j.factcheck_enabled ?? DEF.factcheck_enabled,
      factcheck_timeout_ms: Number(j.factcheck_timeout_ms ?? DEF.factcheck_timeout_ms),
      quiet_outside_tab: j.quiet_outside_tab ?? DEF.quiet_outside_tab,
    }
    if (!(c.idle_ms > TICK_MS)) return bad(`idle_ms must exceed tick ${TICK_MS}`)
    if (!(c.cooldown_ms >= 60000)) return bad("cooldown_ms min 60000")
    if (!(c.max >= 1 && c.max <= 10)) return bad("max must be 1..10")
    if (!(c.curation_timeout_ms >= 60000)) return bad("curation_timeout_ms min 60000")
    if (!(c.presence_away_ms >= 60000)) return bad("presence_away_ms min 60000")
    if (!(c.factcheck_timeout_ms >= 60000)) return bad("factcheck_timeout_ms min 60000")
    return c
  } catch {
    return DEF // no file / bad json -> defaults, never break
  }
}

async function logEvent(e) {
  try {
    await fs.mkdir(MEMDIR, { recursive: true })
    await fs.appendFile(join(MEMDIR, "wake-events.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n")
  } catch {
    // observability is best-effort, never breaks the host
  }
}

// Static fallback nudge (used only when curation itself fails).
const NUDGE = (n, max) =>
  `[wake ${n}/${max}] Curator pass first (inner-curator WAKE-HANDLING): 1) scan this ` +
  "session history — name mistakes, useless loops, unverified claims; " +
  "2) verdict: continue / correct course / stop, with 1-3 next actions; " +
  "3) then act in safe scope only (verify/analyze/plan/hygiene/" +
  "fix-with-tests, never destructive/network/auth). LOOP-GUARD: if the previous " +
  "message here is also a [wake] and nothing changed since, stay silent and vote " +
  "HIBERNATE — never answer a wake with work that re-triggers a wake. " +
  "DONE truly met → one line, stay quiet."

const sessions = new Map() // sessionID -> { idleSince, hadTools, wakes, lastWake, effIdle, errStreak, retired }
const curators = new Set() // curator + factcheck session IDs — never watched, never woken
const pendings = new Map() // targetID -> { curatorID, factID, stage, verdict, startedAt, n, max, reason }
// Active-tab proxy: last session with tool/event activity + timestamp.
let lastActiveSession = null
let lastActiveAt = 0
function markActive(id) {
  lastActiveSession = id
  lastActiveAt = Date.now()
}

// OS presence probe. Zero cost when disabled via config (no exec).
// Returns { os_idle_ms, source, session_type, desktop }. -1 = unknown.
function getPresence(enabled) {
  if (!enabled) return { os_idle_ms: -1, source: "disabled", session_type: "unknown", desktop: "unknown" }
  try {
    const out = execFileSync("bash", [PRESENCE_SH], { timeout: 3000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    const j = JSON.parse(String(out).trim())
    if (typeof j.os_idle_ms !== "number") return { os_idle_ms: -1, source: "parse", session_type: "unknown", desktop: "unknown" }
    return j
  } catch {
    return { os_idle_ms: -1, source: "error", session_type: "unknown", desktop: "unknown" }
  }
}

// Activity matrix: AWAY / FORGOTTEN_TAB / BACKGROUND / PRESENT.
// Deep analysis allowed everywhere except PRESENT (user typing in target).
function presenceLevel(targetID, presence, awayMs, now) {
  const osIdle = presence.os_idle_ms
  const atOS = osIdle >= 0 && osIdle < 60000
  if (osIdle >= 0 && osIdle >= awayMs) return "AWAY"
  if (osIdle === -1) {
    // No OS signal: fall back to app clocks only.
    if (lastActiveSession && lastActiveSession !== targetID && now - lastActiveAt < 3600000) return "FORGOTTEN_TAB"
    return "AWAY"
  }
  if (lastActiveSession === targetID && now - lastActiveAt < 120000 && !atOS) return "PRESENT"
  if (lastActiveSession === targetID && now - lastActiveAt < 120000 && atOS) return "PRESENT"
  if (lastActiveSession && lastActiveSession !== targetID && now - lastActiveAt < 3600000) return "FORGOTTEN_TAB"
  if (atOS) return "BACKGROUND"
  return "AWAY"
}

function rec(id) {
  let r = sessions.get(id)
  if (!r) {
    r = { idleSince: Date.now(), hadTools: false, wakes: 0, lastWake: 0, effIdle: 0, errStreak: 0, retired: false }
    sessions.set(id, r)
  }
  return r
}

function looksError(output) {
  try {
    // Structured signals first (no regex): explicit error status / exit code.
    if (output && typeof output === "object") {
      if (output.status === "error" || output.error === true) return true
      if (typeof output.exitCode === "number" && output.exitCode !== 0) return true
    }
    const s = typeof output?.output === "string" ? output.output : JSON.stringify(output ?? "")
    // Tail, not head: real errors surface at the end of long outputs.
    // Word boundaries + denylist ("0 errors", "error":null, fallback) kill benign hits.
    const tail = s.slice(-2000)
    return /\b(error|failed|traceback|exception|timed out|transport error)\b(?!\s*[:=]\s*(null|0|none|ok|false))\b/i.test(tail) &&
      !/\b(0 errors|no errors|error handling|failure modes|fallback)\b/i.test(tail)
  } catch {
    return false
  }
}

// Deterministic digest of a target session: no LLM, capped, tolerant to
// unknown message shapes (structured extract, JSON fallback per message).
function textOf(m) {
  try {
    const parts = m?.parts ?? m?.content
    if (Array.isArray(parts)) {
      const t = parts
        .map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? ""))
        .filter(Boolean)
        .join("\n")
      if (t) return t.slice(0, 500)
    }
    if (typeof parts === "string" && parts) return parts.slice(0, 500)
    if (typeof m?.text === "string") return m.text.slice(0, 500)
    return JSON.stringify(m).slice(0, 300)
  } catch {
    return ""
  }
}
function roleOf(m, i) {
  return m?.role ?? m?.info?.role ?? (i % 2 === 0 ? "user?" : "agent?")
}

async function composeDigest(client, targetID, limit, statsLine) {
  const d = await client.session.messages({ path: { id: targetID }, query: { limit } })
  const list = d?.data ?? d ?? []
  const arr = Array.isArray(list) ? list.slice(-limit) : []
  // Inherit the tab's live model: last assistant message carries it.
  // Each parallel tab therefore gets a curator on its own model.
  let model = null
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i]
    if ((m?.role ?? m?.info?.role) === "assistant" && m?.modelID && m?.providerID) {
      model = { providerID: m.providerID, modelID: m.modelID }
      break
    }
  }
  let out = `TARGET session ${targetID}\n${statsLine}\n--- recent messages ---\n`
  arr.forEach((m, i) => {
    out += `[${roleOf(m, i)}] ${textOf(m)}\n`
  })
  return { digest: out.slice(0, 8000), model }
}

function fullTextOf(m) {
  try {
    const parts = m?.parts ?? m?.content
    if (Array.isArray(parts)) {
      const t = parts
        .map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? ""))
        .filter(Boolean)
        .join("\n")
      if (t) return t.slice(0, 8000)
    }
    if (typeof parts === "string" && parts) return parts.slice(0, 8000)
    if (typeof m?.text === "string") return m.text.slice(0, 8000)
    return JSON.stringify(m).slice(0, 1000)
  } catch {
    return ""
  }
}

function findVerdict(messages) {
  try {
    const list = messages?.data ?? messages ?? []
    if (!Array.isArray(list)) return null
    for (let i = list.length - 1; i >= 0; i--) {
      const t = fullTextOf(list[i])
      const m = t.match(/\[wake:\s*(CONTINUE|CORRECT|STOP|ABORT|UNKNOWN)[\s\S]{0,3000}/i)
      if (m) return m[0].slice(0, 3000)
    }
    return null
  } catch {
    return null
  }
}

// Last resort: curator finished but ignored the verdict shape — deliver its
// last assistant text raw (marked), better than silence or a static template.
function lastAssistantText(messages) {
  try {
    const list = messages?.data ?? messages ?? []
    if (!Array.isArray(list)) return null
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if ((m?.role ?? m?.info?.role) !== "assistant") continue
      const t = fullTextOf(m).trim()
      if (t) return t.slice(0, 1500)
    }
    return null
  } catch {
    return null
  }
}

export default async (input = {}) => {
  try {
    await fs.appendFile(
      join(MEMDIR, "plugin-load.log"),
      `wake loaded at ${new Date().toISOString()}\n`,
    )
  } catch {
    // marker is best-effort
  }
  const client = input.client
  if (!client?.session?.promptAsync) return {}

  async function inject(targetID, text) {
    await client.session.promptAsync({ path: { id: targetID }, body: { parts: [{ type: "text", text }] } })
  }

  async function cleanupCurator(curatorID) {
    curators.delete(curatorID)
    try {
      await client.session.delete({ path: { id: curatorID } })
    } catch {
      // chat destroyed best-effort; id stays out of the watch set regardless
    }
  }

  // One curation: fetch digest → spawn fresh curator → prompt it.
  // Returns curatorID or null (caller falls back to static nudge).
  // curator_enabled:false → skip spawn, caller uses alarm-only nudge.
  function findFactcheck(messages) {
    try {
      const list = messages?.data ?? messages ?? []
      if (!Array.isArray(list)) return null
      for (let i = list.length - 1; i >= 0; i--) {
        const t = fullTextOf(list[i])
        const m = t.match(/\[factcheck:\s*(PASS|FAIL)[\s\S]{0,2000}/i)
        if (m) return m[0].slice(0, 2000)
      }
      return null
    } catch {
      return null
    }
  }

  async function startFactcheck(targetID, p, verdict, c) {
    try {
      const soul = await fs.readFile(VAULT_FACT, "utf8").catch(() => null)
      const created = await client.session.create({ body: { title: `factcheck:${targetID.slice(-6)}` } })
      const factID = created?.data?.id ?? created?.id
      if (!factID) return null
      curators.add(factID)
      const body = { parts: [{ type: "text", text: `Verify this curator verdict before it reaches the user chat. Verdict:\n${verdict}\n\nReason: ${p.reason}, wake ${p.n}/${p.max}. Return [factcheck:PASS/FAIL] contract only.` }] }
      if (soul) body.system = soul
      if (c.model) body.model = c.model
      await client.session.promptAsync({ path: { id: factID }, body })
      p.factID = factID
      p.stage = "factcheck"
      p.startedAt = Date.now()
      await logEvent({ type: "factcheck_started", session: targetID, fact: factID })
      return factID
    } catch (err) {
      await logEvent({ type: "factcheck_failed", session: targetID, err: String(err).slice(0, 200) })
      return null
    }
  }

  async function startCuration(targetID, reason, n, max, statsLine, c) {
    if (!c.curator_enabled) return null // alarm-only mode, no analysis
    try {
      const { digest, model: liveModel } = await composeDigest(client, targetID, c.digest_messages, statsLine)
      const soul = await fs.readFile(VAULT_AGENT, "utf8").catch(() => null)
      const created = await client.session.create({ body: { title: `curator:${targetID.slice(-6)}` } })
      const curatorID = created?.data?.id ?? created?.id
      if (!curatorID) return null
      curators.add(curatorID)
      // Soul goes to `system` (personality channel), digest to user text.
      // Soul-as-user-text was ignored by the default agent (free-form reply,
      // no parseable verdict) — observed live 2026-09-20.
      const body = { parts: [{ type: "text", text: `Wake ${n}/${max}, reason: ${reason}.\n\n${digest}` }] }
      if (soul) body.system = soul
      // Model inheritance: target tab's live model first, wake.json override second.
      const model = liveModel ?? c.model ?? null
      if (model) body.model = model
      await client.session.promptAsync({ path: { id: curatorID }, body })
      pendings.set(targetID, { curatorID, factID: null, stage: "curate", verdict: null, startedAt: Date.now(), n, max, reason })
      await logEvent({ type: "curation_started", session: targetID, curator: curatorID, reason })
      return curatorID
    } catch (err) {
      await logEvent({ type: "curation_failed", session: targetID, err: String(err).slice(0, 200) })
      return null
    }
  }

  async function settlePendings(c) {
    const now = Date.now()
    for (const [targetID, p] of pendings) {
      try {
        // Stage 2: factcheck running — wait for PASS/FAIL.
        if (p.stage === "factcheck" && p.factID) {
          const fmsgs = await client.session.messages({ path: { id: p.factID }, query: { limit: 20 } })
          const fc = findFactcheck(fmsgs)
          if (fc) {
            const pass = /\[factcheck:\s*PASS/i.test(fc)
            const text = pass
              ? `[wake ${p.n}/${p.max}] ${p.verdict}\n[factcheck:PASS]`
              : `[wake ${p.n}/${p.max}] ${p.verdict}\n${fc.slice(0, 800)}`
            await inject(targetID, text)
            await logEvent({ type: "wake", session: targetID, wakes: p.n, reason: p.reason, mode: pass ? "curated+factcheck-pass" : "curated+factcheck-fail" })
            await cleanupCurator(p.curatorID)
            await cleanupCurator(p.factID)
            pendings.delete(targetID)
            continue
          }
          if (now - p.startedAt > c.factcheck_timeout_ms) {
            await inject(targetID, `[wake ${p.n}/${p.max}] ${p.verdict}\n[factcheck:TIMEOUT — treated as UNVERIFIED]`)
            await logEvent({ type: "wake", session: targetID, wakes: p.n, reason: p.reason, mode: "factcheck-timeout" })
            await cleanupCurator(p.curatorID)
            await cleanupCurator(p.factID)
            pendings.delete(targetID)
          }
          continue
        }
        // Stage 1: curator running — wait for verdict.
        const msgs = await client.session.messages({ path: { id: p.curatorID }, query: { limit: 20 } })
        const verdict = findVerdict(msgs)
        if (verdict) {
          const clean = verdict.startsWith("[wake") ? verdict : verdict
          if (!c.factcheck_enabled) {
            await inject(targetID, `[wake ${p.n}/${p.max}] ${clean}`)
            await logEvent({ type: "wake", session: targetID, wakes: p.n, reason: p.reason, mode: "curated" })
            await cleanupCurator(p.curatorID)
            pendings.delete(targetID)
            continue
          }
          p.verdict = clean
          const factID = await startFactcheck(targetID, p, clean, c)
          if (!factID) {
            await inject(targetID, `[wake ${p.n}/${p.max}] ${clean}\n[factcheck:SKIPPED — spawn failed]`)
            await logEvent({ type: "wake", session: targetID, wakes: p.n, reason: p.reason, mode: "factcheck-spawn-fail" })
            await cleanupCurator(p.curatorID)
            pendings.delete(targetID)
          }
          continue
        }
        if (now - p.startedAt > c.curation_timeout_ms) {
          // Analysis timed out: prefer the curator's raw last text over
          // silence; static nudge only if the curator said nothing at all.
          const raw = lastAssistantText(msgs)
          const text = raw
            ? `[wake ${p.n}/${p.max}] (curator, unformatted):\n${raw}`
            : NUDGE(p.n, p.max)
          await inject(targetID, text)
          await logEvent({ type: "wake", session: targetID, wakes: p.n, reason: p.reason, mode: raw ? "fallback-raw" : "fallback-timeout" })
          await cleanupCurator(p.curatorID)
          pendings.delete(targetID)
        }
      } catch (err) {
        await logEvent({ type: "settle_failed", session: targetID, err: String(err).slice(0, 200) })
      }
    }
  }

  const tick = async () => {
    try {
      const c = await conf()
      if (!c.enabled) return // master alarm switch, hot-reloaded
      await settlePendings(c)
      const presence = getPresence(c.presence_enabled)
      const now = Date.now()
      for (const [id, r] of sessions) {
        if (curators.has(id)) continue // never watch our own curators
        // Eviction: forgotten sessions (>24h unseen) leave the map.
        if (now - r.idleSince > 24 * 60 * 60 * 1000 && now - r.lastWake > 24 * 60 * 60 * 1000) {
          sessions.delete(id)
          continue
        }
        // Terminal state: max wakes reached -> HIBERNATE once, then silence.
        if (r.wakes >= c.max) {
          if (!r.retired) {
            r.retired = true
            await logEvent({ type: "hibernate", session: id, wakes: r.wakes })
          }
          continue
        }
        if (pendings.has(id)) continue // curation already running for this session
        if (!r.hadTools) continue
        // Stall-push: 3+ consecutive error results start analysis immediately.
        const stalled = r.errStreak >= 3
        const need = stalled ? 0 : r.effIdle || c.idle_ms
        if (!stalled && now - r.idleSince < need) continue
        if (now - r.lastWake < c.cooldown_ms) continue
        // Presence gate: user typing IN target tab → silent, log only.
        const level = presenceLevel(id, presence, c.presence_away_ms, now)
        if (level === "PRESENT" && !stalled) {
          await logEvent({ type: "skip-present", session: id, os_idle_ms: presence.os_idle_ms, source: presence.source })
          continue
        }
        r.wakes += 1
        r.lastWake = now
        r.hadTools = false // next wake needs fresh activity first
        r.errStreak = 0
        // Adaptive: ignored wake -> back off 2x, cap 1h.
        r.effIdle = Math.min((r.effIdle || c.idle_ms) * 2, BACKOFF_CAP_MS)
        const reason = stalled ? "stall" : `idle:${level.toLowerCase()}:os${presence.os_idle_ms}ms:${presence.source}`
        const statsLine = `wake ${r.wakes}/${c.max}, reason: ${reason}`
        const curatorID = await startCuration(id, reason, r.wakes, c.max, statsLine, c)
        if (!curatorID) {
          await inject(id, NUDGE(r.wakes, c.max))
          await logEvent({ type: "wake", session: id, wakes: r.wakes, reason, mode: c.curator_enabled ? "fallback-spawn-fail" : "alarm-only" })
        }
      }
    } catch {
      // never break the host
    }
  }
  const timer = setInterval(() => void tick(), TICK_MS)
  if (typeof timer.unref === "function") {
    try {
      timer.unref()
    } catch {
      // ignore
    }
  }

  return {
    "tool.execute.after": async (toolInput, output) => {
      try {
        const id = toolInput?.sessionID
        if (!id || curators.has(id)) return // our curators never re-arm anything
        markActive(id)
        const r = rec(id)
        r.idleSince = Date.now() // activity resets the idle clock
        // Blind window: tools fired by our own just-sent verdict (agent
        // verifying) must not re-arm the watchdog — else wake→verify→wake.
        if (Date.now() - r.lastWake < POST_WAKE_BLIND_MS) return
        r.hadTools = true
        r.effIdle = 0 // alive again -> backoff cleared
        r.errStreak = looksError(output) ? r.errStreak + 1 : 0
      } catch {
        // never break the session
      }
    },
    event: async ({ event } = {}) => {
      try {
        const payload = event?.properties ?? event?.data ?? {}
        const id = payload.sessionID
        if (!id) return
        if (!curators.has(id)) markActive(id)
        if (event?.type === "session.idle") rec(id).idleSince = Date.now()
        if (event?.type === "session.status" && payload?.status?.type === "idle") {
          rec(id).idleSince = Date.now()
        }
      } catch {
        // never break the session
      }
    },
  }
}
