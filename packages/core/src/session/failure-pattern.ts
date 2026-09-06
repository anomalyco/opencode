export * as FailurePattern from "./failure-pattern"

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { SessionSchema } from "./schema"
import { ReflectionState } from "./runner/reflection-state"

export interface FailureResolution {
  readonly signature: string
  readonly name: string
  readonly description: string
  readonly recommendedAction: string
  readonly autoFixSnippet?: string
  successCount: number
  lastAppliedAt?: number
}

const PATTERNS_FILE = path.join(os.homedir(), ".opencode", "failure_patterns.json")

const BUILTIN_RESOLUTIONS: FailureResolution[] = [
  {
    signature: "ENOENT: no such file or directory",
    name: "Missing Directory or File",
    description: "A target directory or file was referenced before being created.",
    recommendedAction: "Ensure parent directories exist with mkdir -p before creating files or reading paths.",
    autoFixSnippet: "mkdir -p $(dirname <path>)",
    successCount: 1,
  },
  {
    signature: "Cannot find module",
    name: "Missing Dependency",
    description: "An imported module or package is not installed in the current environment.",
    recommendedAction: "Run bun add or bun install to add the missing dependency to package.json.",
    autoFixSnippet: "bun add <package>",
    successCount: 1,
  },
  {
    signature: "EADDRINUSE: address already in use",
    name: "Port Conflict",
    description: "A server or test runner attempted to bind to a port already occupied by another process.",
    recommendedAction: "Terminate the existing process with fuser -k <port>/tcp or use an alternate ephemeral port.",
    autoFixSnippet: "fuser -k <port>/tcp",
    successCount: 1,
  },
  {
    signature: "index.lock': File exists",
    name: "Stale Git Lockfile",
    description: "A prior git process was interrupted, leaving a stale lockfile.",
    recommendedAction: "Remove the stale lockfile: rm -f .git/index.lock",
    autoFixSnippet: "rm -f .git/index.lock",
    successCount: 1,
  },
  {
    signature: "SQLITE_BUSY: database is locked",
    name: "SQLite Concurrency Contention",
    description: "Multiple threads or processes are attempting write transactions simultaneously.",
    recommendedAction: "Enable WAL mode on sqlite database and add retry with exponential backoff.",
    autoFixSnippet: "PRAGMA journal_mode=WAL;",
    successCount: 1,
  },
  {
    signature: "fatal: could not read Username for 'https://github.com': No such device or address",
    name: "Git Auth Prompt Disallowed",
    description: "Interactive git prompt failed in non-interactive environment.",
    recommendedAction: "Configure git credentials or use SSH remote URL instead of HTTPS.",
    successCount: 1,
  },
]

const patternStore = new Map<string, FailureResolution>()

function initStore() {
  if (patternStore.size > 0) return
  for (const b of BUILTIN_RESOLUTIONS) {
    patternStore.set(normalizeSignature(b.signature), b)
  }

  try {
    if (fs.existsSync(PATTERNS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf8")) as FailureResolution[]
      for (const item of saved) {
        patternStore.set(normalizeSignature(item.signature), item)
      }
    }
  } catch {
    // Ignore read errors
  }
}

function persistStore() {
  try {
    const dir = path.dirname(PATTERNS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const array = Array.from(patternStore.values())
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(array, null, 2), "utf8")
  } catch {
    // Ignore write errors
  }
}

export const normalizeSignature = (errorMessage: string, stackTrace?: string): string => {
  let text = errorMessage
  if (stackTrace) text += `\n${stackTrace}`

  return text
    .replace(/\/[\w./-]+/g, "<path>") // Replace unix file paths
    .replace(/[a-zA-Z]:\\[\w.\-\\]+/g, "<path>") // Replace windows file paths
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>") // UUIDs
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>") // Hex pointers
    .replace(/:\d+:\d+/g, ":<line>:<col>") // Line/col numbers
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\b/g, "<timestamp>") // Timestamps
    .toLowerCase()
    .trim()
}

export const lookupResolution = (
  errorMessage: string,
  stackTrace?: string,
): FailureResolution | undefined => {
  initStore()
  const norm = normalizeSignature(errorMessage, stackTrace)

  // Direct normalized match
  if (patternStore.has(norm)) {
    return patternStore.get(norm)
  }

  // Substring signature match
  for (const [sig, res] of patternStore.entries()) {
    if (norm.includes(sig) || errorMessage.toLowerCase().includes(sig)) {
      return res
    }
  }

  return undefined
}

export const recordResolution = (
  errorMessage: string,
  resolution: Omit<FailureResolution, "signature" | "successCount">,
): FailureResolution => {
  initStore()
  const sig = normalizeSignature(errorMessage)
  const existing = patternStore.get(sig)
  if (existing) {
    existing.successCount++
    existing.lastAppliedAt = Date.now()
    persistStore()
    return existing
  }

  const created: FailureResolution = {
    ...resolution,
    signature: sig,
    successCount: 1,
    lastAppliedAt: Date.now(),
  }
  patternStore.set(sig, created)
  persistStore()
  return created
}

export const applyResolutionToSession = (
  sessionID: SessionSchema.ID,
  resolution: FailureResolution,
): void => {
  resolution.successCount++
  resolution.lastAppliedAt = Date.now()
  persistStore()

  const steerText = `[Auto-Healing Matched Known Failure]: ${resolution.name}\nDiagnosis: ${resolution.description}\nRecommended Fix: ${resolution.recommendedAction}${resolution.autoFixSnippet ? `\nCommand: ${resolution.autoFixSnippet}` : ""}`
  ReflectionState.addSteer(sessionID, steerText)
  ReflectionState.addReasoningLog(sessionID, {
    type: "why_loop",
    content: `Auto-healing applied resolution for '${resolution.name}'`,
    metadata: {
      signature: resolution.signature,
      recommendation: resolution.recommendedAction,
      autoFixSnippet: resolution.autoFixSnippet,
    },
  })
}
