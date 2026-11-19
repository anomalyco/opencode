/** OpenCode adapter: disk store (spec Part A §4.2, Part B §3.2/§3.3). */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { LedgerLine, MetricEvent, SessionState } from "../../core/types"
import type { StorePort } from "../../core/ports"

export interface StoreOptions {
  dataDir: string
  /** defaults to console.error; injected by tests and the plugin for fork-style logging */
  log?: (message: string) => void
}

const SID_RE = /^[A-Za-z0-9_-]+$/

function validateSid(sid: string): void {
  if (!SID_RE.test(sid)) throw new Error(`invalid session id: ${sid}`)
}

function sessionDir(dataDir: string, sid: string): string {
  validateSid(sid)
  return path.join(dataDir, sid)
}

export function createStore(opts: StoreOptions): StorePort & {
  withSessionLock<T>(sid: string, fn: () => Promise<T>): Promise<T>
  readStateRaw(sid: string): Promise<SessionState | null>
  writeStateRaw(sid: string, s: SessionState): Promise<void>
  readLedgerRaw(sid: string): Promise<LedgerLine[]>
  appendLedgerRaw(sid: string, lines: LedgerLine[]): Promise<void>
  markGitignore(projectDir: string): Promise<void>
} {
  const log = opts.log ?? ((m: string) => console.error(`[rollover-store] ${m}`))
  const locks = new Map<string, Promise<unknown>>()

  function withSessionLock<T>(sid: string, fn: () => Promise<T>): Promise<T> {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const next = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    const prevLock = locks.get(sid) ?? Promise.resolve()
    locks.set(sid, next)
    prevLock
      .then(
        () => {},
        () => {},
      )
      .then(() => fn())
      .then((result) => resolve(result as T), reject)
      .finally(() => {
        if (locks.get(sid) === next) locks.delete(sid)
      })
    return next
  }

  async function readStateRaw(sid: string): Promise<SessionState | null> {
    validateSid(sid)
    const dir = sessionDir(opts.dataDir, sid)
    const file = path.join(dir, "state.json")
    if (!existsSync(file)) return null
    let raw: string
    try {
      raw = readFileSync(file, "utf8")
    } catch (e) {
      log(`state read failed: ${String(e)}`)
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      log(`state json parse failed: ${String(e)}`)
      return null
    }
    if (typeof parsed !== "object" || parsed === null) {
      log("state is not an object")
      return null
    }
    const v = (parsed as { v?: unknown }).v
    if (v !== 1) {
      log(`state version ${String(v)} not supported (expected 1); skipping`)
      return null
    }
    return parsed as SessionState
  }

  async function writeStateRaw(sid: string, s: SessionState): Promise<void> {
    validateSid(sid)
    const dir = sessionDir(opts.dataDir, sid)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "state.json")
    const tmp = path.join(dir, `state.json.tmp-${process.pid}`)
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }

  async function readLedgerRaw(sid: string): Promise<LedgerLine[]> {
    validateSid(sid)
    const dir = sessionDir(opts.dataDir, sid)
    const file = path.join(dir, "ledger.jsonl")
    if (!existsSync(file)) return []
    const raw = readFileSync(file, "utf8")
    const out: LedgerLine[] = []
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (trimmed === "") continue
      try {
        out.push(JSON.parse(trimmed) as LedgerLine)
      } catch (e) {
        log(`skipping corrupt ledger line: ${String(e)}`)
      }
    }
    return out
  }

  async function appendLedgerRaw(sid: string, lines: LedgerLine[]): Promise<void> {
    validateSid(sid)
    const dir = sessionDir(opts.dataDir, sid)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "ledger.jsonl")
    const payload = lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
    appendFileSync(file, payload)
  }

  async function readState(sid: string): Promise<SessionState | null> {
    validateSid(sid)
    return withSessionLock(sid, () => readStateRaw(sid))
  }

  async function writeState(sid: string, s: SessionState): Promise<void> {
    validateSid(sid)
    return withSessionLock(sid, () => writeStateRaw(sid, s))
  }

  async function appendLedger(sid: string, lines: LedgerLine[]): Promise<void> {
    validateSid(sid)
    return withSessionLock(sid, () => appendLedgerRaw(sid, lines))
  }

  async function readLedger(sid: string): Promise<LedgerLine[]> {
    validateSid(sid)
    return withSessionLock(sid, () => readLedgerRaw(sid))
  }

  async function appendMetric(sid: string, ev: MetricEvent): Promise<void> {
    validateSid(sid)
    return withSessionLock(sid, async () => {
      const dir = sessionDir(opts.dataDir, sid)
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, "metrics.jsonl")
      appendFileSync(file, JSON.stringify(ev) + "\n")
    })
  }

  async function markGitignore(projectDir: string): Promise<void> {
    const gitignore = path.join(projectDir, ".gitignore")
    const entry = ".opencode/rollover/"
    let content = ""
    if (existsSync(gitignore)) content = readFileSync(gitignore, "utf8")
    const lines = content.split("\n")
    if (lines.some((l) => l.trim() === entry || l.trim() === ".opencode/rollover")) return
    const next = content.length > 0 && !content.endsWith("\n") ? content + "\n" + entry + "\n" : content + entry + "\n"
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(gitignore, next)
  }

  return {
    readState,
    writeState,
    appendLedger,
    readLedger,
    appendMetric,
    withSessionLock,
    readStateRaw,
    writeStateRaw,
    readLedgerRaw,
    appendLedgerRaw,
    markGitignore,
  }
}
