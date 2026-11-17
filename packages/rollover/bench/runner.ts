/** Benchmark runner (spec §7): drives the fork-built binary against the local
 * mock LLM inside an XDG sandbox. Every scenario runs in a dedicated project;
 * baseline disables the plugin (mode "off"), experimental enables it.
 * Never touches the global OpenCode install or real sessions (spec Part B §1). */
import { spawn, type ChildProcess } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { startMockLlm } from "./mock-llm/server"

export const SCENARIO_IDS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10"] as const
export type ScenarioId = (typeof SCENARIO_IDS)[number]
export type BenchMode = "baseline" | "experimental"

export interface SeedTurn {
  prompt: string
  script: { match?: string; content: string; toolCalls?: Array<{ id: string; name: string; args: string }> }
}

export interface ExtractionRecordSeed {
  type: string
  text: string
  status?: string
  process?: { command: string; purpose: string; onResult: string }
}

export interface Seed {
  id: string
  title: string
  thresholdTokens: number
  tailN?: number
  files?: Record<string, string>
  turns: SeedTurn[]
  extractionRecords?: ExtractionRecordSeed[]
  extractionOverride?: "INVALID_JSON"
  consolidateAfterRecords?: number
  initialLedgerSpec?: { count: number; types: string[]; textPrefix: string }
  multiSession?: Array<{ label: string; turnIndexes: number[] }>
  restartAfterTurn?: number
  notes?: string
}

export interface HiddenCase {
  id: string
  expectsRollover: boolean
  expectsDeferred?: boolean
  facts: Array<{ kind: string; text: string }>
  mustNotAppear: string[]
  requiresRuntimeEvidence: boolean
  notes?: string
}

export interface ScenarioResult {
  scenario: ScenarioId
  mode: BenchMode
  ok: boolean
  error?: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** null when the model has no price entry (spec §7.6: do not invent pricing). */
  cost: number | null
  peakContextTokens: number
  llmCalls: number
  extractionCalls: number
  consolidationCalls: number
  extractionMs: number
  consolidationMs: number
  swapLatenciesMs: number[]
  contextReductions: Array<{ before: number; after: number }>
  rollovers: { ok: number; deferred: number; failed: number }
  artifacts?: {
    records: Array<{ id: string; type: string; text: string }>
    invalidated: Array<{ id: string; type: string; text: string }>
    renderText: string | null
  }
  epochs: number
  sessionIDs: string[]
}

const PKG_ROOT = path.resolve(import.meta.dir, "..")
const FORK_ROOT = path.resolve(PKG_ROOT, "../..")
const LAUNCHER = path.join(PKG_ROOT, "scripts", "dev-opencode.sh")
const DEFAULT_BIN = path.join(FORK_ROOT, "packages/cli/dist/rollover-test/cli-darwin-arm64/bin/opencode")
const MODEL = "mockllm/test-model"

const EXTRACTION_MARKER = "You maintain a durable memory ledger"
const CONSOLIDATION_MARKER = "You clean a memory ledger"

export async function loadSeed(id: ScenarioId): Promise<Seed> {
  return (await Bun.file(path.join(PKG_ROOT, "bench/seed", `${id}.json`)).json()) as Seed
}

export async function loadHidden(id: ScenarioId): Promise<HiddenCase> {
  return (await Bun.file(path.join(PKG_ROOT, "bench/hidden", `${id}.json`)).json()) as HiddenCase
}

export function loadPricing(): Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> {
  const raw = JSON.parse(readFileSync(path.join(PKG_ROOT, "bench/pricing.json"), "utf8")) as {
    models: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>
  }
  return raw.models
}

/** Build the per-scenario mock script: extraction/consolidation answers first
 * (their markers must win over conversational matches), then turn scripts. */
export function buildMockScript(seed: Seed) {
  const extractionContent = seed.extractionOverride === "INVALID_JSON"
    ? "This is not valid JSON at all."
    : JSON.stringify({ records: seed.extractionRecords ?? [] })
  const script = [
    { match: EXTRACTION_MARKER, content: extractionContent },
    { match: CONSOLIDATION_MARKER, content: '{"invalidate":[]}' },
    ...seed.turns.map((t) => ({ ...t.script })),
  ]
  return script
}

type RequestClass = "extraction" | "consolidation" | "conversation" | "other"

export function classifyRequest(body: unknown): RequestClass {
  const text = JSON.stringify(body ?? "")
  if (text.includes(EXTRACTION_MARKER)) return "extraction"
  if (text.includes(CONSOLIDATION_MARKER)) return "consolidation"
  return "conversation"
}

export interface RecordedRequestLike {
  body?: unknown
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
}

export function summarizeRequests(requests: RecordedRequestLike[]) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let llmCalls = 0
  let extractionCalls = 0
  let consolidationCalls = 0
  let peakContextTokens = 0
  for (const r of requests) {
    llmCalls++
    const kind = classifyRequest(r.body)
    if (kind === "extraction") extractionCalls++
    if (kind === "consolidation") consolidationCalls++
    tokens.input += r.usage?.input ?? 0
    tokens.output += r.usage?.output ?? 0
    tokens.cacheRead += r.usage?.cacheRead ?? 0
    tokens.cacheWrite += r.usage?.cacheWrite ?? 0
    if (kind === "conversation") peakContextTokens = Math.max(peakContextTokens, r.usage?.input ?? 0)
  }
  return { tokens, llmCalls, extractionCalls, consolidationCalls, peakContextTokens }
}

export function computeCost(
  model: string,
  tokens: ScenarioResult["tokens"],
  pricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = loadPricing(),
): number | null {
  const price = pricing[model]
  if (!price) return null
  return (
    (tokens.input * price.input + tokens.output * price.output +
      tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1_000_000
  )
}

function sandboxEnv(sandbox: string, bin: string): Record<string, string> {
  // Built from scratch on purpose: no credential variables can leak into the
  // benchmark runtime (spec Part B §1.3 credential scrubbing).
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    HOME: path.join(sandbox, "home"),
    XDG_CONFIG_HOME: path.join(sandbox, "config"),
    XDG_DATA_HOME: path.join(sandbox, "data"),
    XDG_CACHE_HOME: path.join(sandbox, "cache"),
    XDG_STATE_HOME: path.join(sandbox, "state"),
    OPENCODE_CONFIG_DIR: path.join(sandbox, "config", "opencode"),
    ROLLOVER_SANDBOX: sandbox,
    ROLLOVER_BIN: bin,
  }
}

function runLauncher(env: Record<string, string>, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [LAUNCHER, ...args], { env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout })
    })
  })
}

function startServe(env: Record<string, string>, projectDir: string, logPath: string, port: number): ChildProcess {
  const log = appendFileSync.bind(null, logPath) as (s: string) => void
  const child = spawn("bash", [LAUNCHER, projectDir, "serve", "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.on("data", (d: Buffer) => log(d.toString()))
  child.stderr?.on("data", (d: Buffer) => log(d.toString()))
  return child
}

async function waitServePassword(logPath: string, timeoutMs = 30_000): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(logPath)) {
      const text = readFileSync(logPath, "utf8")
      const m = /server password (\S+)/.exec(text)
      if (m) return m[1]
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`serve did not report a password within ${timeoutMs}ms (log: ${logPath})`)
}

async function apiCreateSession(port: number, password: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
    body: "{}",
  })
  if (!res.ok) throw new Error(`session create failed: HTTP ${res.status}`)
  const json = (await res.json()) as { data: { id: string } }
  return json.data.id
}

function prepareSandbox(sandbox: string, seed: Seed, mode: BenchMode, bin: string, mockUrl: string): string {
  const projectDir = path.join(sandbox, "project")
  mkdirSync(path.join(projectDir, ".opencode", "plugin"), { recursive: true })
  mkdirSync(path.join(sandbox, "config", "opencode"), { recursive: true })
  mkdirSync(path.join(sandbox, "home"), { recursive: true })
  mkdirSync(path.join(sandbox, "data"), { recursive: true })
  mkdirSync(path.join(sandbox, "cache"), { recursive: true })
  mkdirSync(path.join(sandbox, "state"), { recursive: true })
  mkdirSync(path.join(sandbox, "serve"), { recursive: true })

  for (const [name, content] of Object.entries(seed.files ?? {})) {
    writeFileSync(path.join(projectDir, name), content)
  }

  const settings: Record<string, unknown> =
    mode === "experimental"
      ? {
          mode: "auto",
          thresholdTokens: seed.thresholdTokens,
          ...(seed.tailN !== undefined ? { tailN: seed.tailN } : {}),
          ...(seed.consolidateAfterRecords !== undefined ? { consolidateAfterRecords: seed.consolidateAfterRecords } : {}),
        }
      : { mode: "off" }
  writeFileSync(path.join(projectDir, ".opencode", "rollover.json"), JSON.stringify(settings))

  writeFileSync(
    path.join(sandbox, "config", "opencode", "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        mockllm: {
          npm: "@ai-sdk/openai-compatible",
          name: "MockLLM",
          options: { baseURL: `${mockUrl}/v1` },
          models: { "test-model": { name: "Test Model", limit: { context: 100000, output: 4000 } } },
        },
      },
      model: MODEL,
      small_model: MODEL,
      autoupdate: false,
    }),
  )

  // Register the real package plugin via the P0-10-verified file path.
  writeFileSync(
    path.join(projectDir, ".opencode", "plugin", "rollover.ts"),
    `export { default } from "${path.join(PKG_ROOT, "src/plugin-entry.ts")}"\n`,
  )

  return projectDir
}

function seedInitialLedger(projectDir: string, sid: string, spec: NonNullable<Seed["initialLedgerSpec"]>): void {
  const dir = path.join(projectDir, ".opencode", "rollover", sid)
  mkdirSync(dir, { recursive: true })
  const lines: string[] = []
  for (let i = 0; i < spec.count; i++) {
    const type = spec.types[i % spec.types.length]
    lines.push(JSON.stringify({
      kind: "record", id: `r_preseed_${String(i).padStart(4, "0")}`, type,
      text: `${spec.textPrefix} ${i}: deterministic benchmark filler record for render budget pressure.`,
      epoch: 0, userMessageId: "u_preseed", turnMessageId: "a_preseed", createdAt: 0,
    }))
  }
  writeFileSync(path.join(dir, "ledger.jsonl"), lines.join("\n") + "\n")
}

interface MetricLine {
  ev: string
  ts: number
  epoch?: number
  swapMs?: number
  tokensBefore?: number
  tokensAfter?: number
  reason?: string
}

function collectSessions(projectDir: string, sessionIDs: string[]) {
  let epochs = 0
  const swapLatenciesMs: number[] = []
  const contextReductions: Array<{ before: number; after: number }> = []
  let rolloversOk = 0
  let renderText: string | null = null
  const recordMap = new Map<string, { id: string; type: string; text: string }>()
  const invalidatedIds = new Set<string>()
  let deferred = 0
  let failed = 0
  const extractionStarts: number[] = []
  let extractionMs = 0
  const consolidationStarts: number[] = []
  let consolidationMs = 0
  for (const sid of sessionIDs) {
    const dir = path.join(projectDir, ".opencode", "rollover", sid)
    try {
      const st = JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8")) as { epoch?: number; rollover?: { renderText?: string } | null }
      epochs = Math.max(epochs, st.epoch ?? 0)
      if (st.rollover?.renderText) renderText = st.rollover.renderText
    } catch {}
    const ledgerPath = path.join(dir, "ledger.jsonl")
    if (existsSync(ledgerPath)) {
      for (const line of readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean)) {
        let l: { kind?: string; id?: string; type?: string; text?: string }
        try { l = JSON.parse(line) } catch { continue }
        if (l.kind === "record" && l.id && l.type && typeof l.text === "string") {
          recordMap.set(l.id, { id: l.id, type: l.type, text: l.text })
        } else if (l.kind === "invalidate" && typeof l.id === "string") {
          invalidatedIds.add(l.id)
        }
      }
    }
    const metricsPath = path.join(dir, "metrics.jsonl")
    if (!existsSync(metricsPath)) continue
    const lines = readFileSync(metricsPath, "utf8").split("\n").filter(Boolean)
    for (const line of lines) {
      let m: MetricLine
      try { m = JSON.parse(line) as MetricLine } catch { continue }
      if (m.ev === "swap") {
        rolloversOk++
        if (typeof m.swapMs === "number") swapLatenciesMs.push(m.swapMs)
        if (typeof m.tokensBefore === "number" && typeof m.tokensAfter === "number") {
          contextReductions.push({ before: m.tokensBefore, after: m.tokensAfter })
        }
      }
      else if (m.ev === "swap_deferred") deferred++
      else if (m.ev === "extraction_failed") failed++
      else if (m.ev === "extraction_started") extractionStarts.push(m.ts)
      else if (m.ev === "extraction_completed" && extractionStarts.length > 0) extractionMs += m.ts - extractionStarts.shift()!
      else if (m.ev === "consolidation_started") consolidationStarts.push(m.ts)
      else if (m.ev === "consolidation_completed" && consolidationStarts.length > 0) consolidationMs += m.ts - consolidationStarts.shift()!
    }
  }
  const records: Array<{ id: string; type: string; text: string }> = []
  const invalidated: Array<{ id: string; type: string; text: string }> = []
  for (const r of recordMap.values()) {
    if (invalidatedIds.has(r.id)) invalidated.push(r)
    else records.push(r)
  }
  return {
    epochs,
    swapLatenciesMs,
    contextReductions,
    rollovers: { ok: rolloversOk, deferred, failed },
    extractionMs,
    consolidationMs,
    artifacts: { records, invalidated, renderText },
  }
}

/** Drive one scenario in one mode. The sandbox dir must live under the
 * opencode-rollover- temp prefix (same rule as scripts/dev-opencode.sh). */
export async function runScenario(opts: {
  scenario: ScenarioId
  mode: BenchMode
  sandboxDir: string
  bin?: string
}): Promise<ScenarioResult> {
  const { scenario, mode } = opts
  const bin = opts.bin ?? process.env.OPENCODE_BIN ?? DEFAULT_BIN
  const base: ScenarioResult = {
    scenario, mode, ok: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: null, peakContextTokens: 0, llmCalls: 0, extractionCalls: 0, consolidationCalls: 0,
    extractionMs: 0, consolidationMs: 0, swapLatenciesMs: [], contextReductions: [],
    rollovers: { ok: 0, deferred: 0, failed: 0 }, epochs: 0, sessionIDs: [],
  }
  if (!bin.startsWith(FORK_ROOT)) return { ...base, error: `binary ${bin} is not inside the fork tree` }
  if (!opts.sandboxDir.includes("opencode-rollover-")) return { ...base, error: "sandbox dir must match the opencode-rollover- prefix" }

  const seed = await loadSeed(scenario)
  rmSync(opts.sandboxDir, { recursive: true, force: true })

  const mock = await startMockLlm({ port: 0, script: buildMockScript(seed), autoUsage: true })
  let serve: ChildProcess | null = null
  const env = sandboxEnv(opts.sandboxDir, bin)
  try {
    const projectDir = prepareSandbox(opts.sandboxDir, seed, mode, bin, mock.url)
    const serveLog = path.join(opts.sandboxDir, "serve", "serve.log")
    const port = 4600 + (process.pid % 400)
    serve = startServe(env, projectDir, serveLog, port)
    const password = await waitServePassword(serveLog)

    const labels = seed.multiSession?.map((s) => s.label) ?? ["main"]
    const sessionByLabel = new Map<string, string>()
    for (const label of labels) {
      const sid = await apiCreateSession(port, password)
      sessionByLabel.set(label, sid)
      if (seed.initialLedgerSpec && mode === "experimental" && label === labels[0]) {
        seedInitialLedger(projectDir, sid, seed.initialLedgerSpec)
      }
    }
    const sessionFor = (turnIndex: number): string => {
      if (!seed.multiSession) return sessionByLabel.get("main")!
      for (const s of seed.multiSession) {
        if (s.turnIndexes.includes(turnIndex)) return sessionByLabel.get(s.label)!
      }
      return sessionByLabel.get(labels[0])!
    }

    for (let i = 0; i < seed.turns.length; i++) {
      const sid = sessionFor(i)
      const res = await runLauncher(env, [projectDir, "run", "-m", MODEL, "-s", sid, seed.turns[i].prompt], 120_000)
      if (res.code !== 0) throw new Error(`turn ${i + 1} exited ${res.code}: ${res.stdout.slice(-400)}`)
      if (seed.restartAfterTurn === i + 1) {
        serve.kill("SIGTERM")
        serve = null
        await new Promise((r) => setTimeout(r, 800))
        rmSync(serveLog, { force: true })
        serve = startServe(env, projectDir, serveLog, port)
        await waitServePassword(serveLog)
      }
    }

    const sessionIDs = [...new Set(sessionByLabel.values())]
    const collected = collectSessions(projectDir, sessionIDs)
    const summary = summarizeRequests(mock.requests())
    const result: ScenarioResult = {
      ...base,
      ok: true,
      ...summary,
      tokens: summary.tokens,
      cost: computeCost(MODEL, summary.tokens),
      ...collected,
      sessionIDs,
    }
    return result
  } catch (e) {
    return { ...base, error: String(e) }
  } finally {
    if (serve) serve.kill("SIGTERM")
    await mock.stop()
  }
}
