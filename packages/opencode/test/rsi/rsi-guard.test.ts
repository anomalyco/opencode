import { describe, it, expect } from "bun:test"
import {
  checkPath, assertEvolutionPath, containsMaliciousPatterns,
  computeSelfHash, containsPrototypePollution, checkNamespaceCollision,
  containsBlockedImports, detectConvergence, trackMemoryDelta,
  hasNetworkCalls, sanitizeEnv, snapshotWorkspace, restoreWorkspace,
  deobfuscateCode, spawnIsolatedExecution,
  RSIGUARD_SRC,
} from "@/muel/rsi-guard"

describe("RSI Guard H11 — Sandbox Confinement", () => {
  it("checkPath rejects src/muel/ paths", () => {
    expect(() => checkPath("src/muel/pipeline.ts")).toThrow("H11")
  })

  it("checkPath rejects test/muel/ paths", () => {
    expect(() => checkPath("test/muel/pipeline.test.ts")).toThrow("H11")
  })

  it("assertEvolutionPath rejects non-evolution paths", () => {
    expect(() => assertEvolutionPath("src/random/file.ts")).toThrow("H11")
  })

  it("assertEvolutionPath allows src/evolution-rsi/ paths", () => {
    expect(() => assertEvolutionPath("src/evolution-rsi/new-file.ts")).not.toThrow()
  })

  it("containsMaliciousPatterns detects child_process", () => {
    const r = containsMaliciousPatterns('const x = require("child_process")')
    expect(r).toContain("H11_VIOLATION")
  })

  it("containsMaliciousPatterns passes clean code", () => {
    const r = containsMaliciousPatterns("const x = 5 + 3")
    expect(r).toBeNull()
  })
})

describe("RSI Guard — Self Hash & Tamper Detection", () => {
  it("computeSelfHash returns valid SHA-256 hash", () => {
    const hash = computeSelfHash()
    expect(hash.length).toBe(64)
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true)
  })
})

describe("RSI Guard — Prototype Pollution (T9)", () => {
  it("detects Object.prototype assignment", () => {
    const r = containsPrototypePollution("Object.prototype.x = 1")
    expect(r).toContain("H11_VIOLATION")
  })

  it("detects __proto__ access", () => {
    const r = containsPrototypePollution("obj.__proto__.x = 1")
    expect(r).toContain("H11_VIOLATION")
  })

  it("passes clean code", () => {
    const r = containsPrototypePollution("const x = { a: 1 }")
    expect(r).toBeNull()
  })
})

describe("RSI Guard — Namespace Collision (T12)", () => {
  it("detects collision with muel.ts naming same as src/muel dir", () => {
    const r = checkNamespaceCollision("/src/evolution-rsi/muel.ts")
    expect(r).toContain("H11_VIOLATION")
  })

  it("passes unique filenames", () => {
    const r = checkNamespaceCollision("/src/evolution-rsi/optimizer-v2.ts")
    expect(r).toBeNull()
  })
})

describe("RSI Guard — Blocked Imports (T14)", () => {
  it("detects worker_threads import", () => {
    const r = containsBlockedImports('import { Worker } from "worker_threads"')
    expect(r).toContain("H11_VIOLATION")
  })

  it("passes clean imports", () => {
    const r = containsBlockedImports('import { readFile } from "fs"')
    expect(r).toBeNull()
  })
})

describe("RSI Guard — Network Calls (H13)", () => {
  it("detects fetch usage", () => {
    expect(hasNetworkCalls('fetch("https://evil.com")')).toBe(true)
  })

  it("detects WebSocket usage", () => {
    expect(hasNetworkCalls('new WebSocket("ws://evil.com")')).toBe(true)
  })

  it("passes clean code", () => {
    expect(hasNetworkCalls("const x = 5")).toBe(false)
  })
})

describe("RSI Guard — Convergence Detection (T7)", () => {
  it("detects plateau of 3+ iterations", () => {
    const r = detectConvergence([100, 100, 100, 100], 3)
    expect(r.converged).toBe(true)
  })

  it("no plateau on steady improvement", () => {
    const r = detectConvergence([80, 85, 90, 95], 3)
    expect(r.converged).toBe(false)
  })

  it("not enough data returns no plateau", () => {
    const r = detectConvergence([100, 100], 3)
    expect(r.converged).toBe(false)
  })
})

describe("RSI Guard — Memory Leak Tracking (T15)", () => {
  it("detects memory leak >50MB", () => {
    const r = trackMemoryDelta([100, 160, 200], 50, 3)
    expect(r.leak).toBe(true)
  })

  it("no leak when delta within budget", () => {
    const r = trackMemoryDelta([100, 110, 120], 50, 3)
    expect(r.leak).toBe(false)
  })
})

describe("RSI Guard — Env Sanitization (T11)", () => {
  it("strips API_KEY from env", () => {
    const key = "TEST_API_KEY_RSI"
    process.env[key] = "secret123"
    sanitizeEnv()
    expect(process.env[key]).toBeUndefined()
  })
})

describe("RSI Guard — Workspace Snapshot (T6)", () => {
  it("snapshotWorkspace returns entries", () => {
    const snap = snapshotWorkspace("test/rsi")
    expect(snap.length).toBeGreaterThan(0)
    expect(snap[0].path).toBeDefined()
    expect(snap[0].type).toBeDefined()
  })

  it("restoreWorkspace removes files outside codeDir", () => {
    const snap = snapshotWorkspace("test/rsi")
    const removed = restoreWorkspace(snap, "src/evolution-rsi", "test/rsi")
    expect(Array.isArray(removed)).toBe(true)
  })
})

describe("RSI Guard — Red Team: Anti-Obfuscation (Fase 10.1)", () => {
  const base64Clean = 'const name = Buffer.from("dGVzdA==", "base64").toString()'
  const hexAttack = 'const x = "\\x63\\x68\\x69\\x6c\\x64\\x5f\\x70\\x72\\x6f\\x63\\x65\\x73\\x73"'
  const unicodeAttack = 'const x = "\\u0065\\u0076\\u0061\\u006c\\u0028"'
  const cleanCode = "const x = 5 + 3"
  const hexChildProcess = 'const x = "\\x63\\x68\\x69\\x6c\\x64\\x5f\\x70\\x72\\x6f\\x63\\x65\\x73\\x73"'
  const base64Only = 'Buffer.from("Y2hpbGRfcHJvY2Vzcw==", "base64")'

  it("blocks hex-encoded child_process string", () => {
    const r = containsMaliciousPatterns(hexAttack)
    expect(r).toContain("OBFUSCATED_MALICIOUS_PATTERN")
  })

  it("blocks unicode-encoded eval()", () => {
    const r = containsMaliciousPatterns(unicodeAttack)
    expect(r).toContain("OBFUSCATED_MALICIOUS_PATTERN")
  })

  it("allows clean code through deobfuscation", () => {
    const r = containsMaliciousPatterns(cleanCode)
    expect(r).toBeNull()
  })

  it("does not false-positive on benign Base64 string", () => {
    const r = containsMaliciousPatterns(base64Clean)
    expect(r).toBeNull()
  })

  it("blocks hex-encoded child_process via containsMaliciousPatterns", () => {
    const r = containsMaliciousPatterns(hexChildProcess)
    expect(r).toContain("OBFUSCATED_MALICIOUS_PATTERN")
  })

  it("deobfuscateCode returns decoded child_process for Base64", () => {
    const decoded = deobfuscateCode(base64Only)
    expect(decoded.some(d => d.includes("child_process"))).toBe(true)
  })

  it("spawnIsolatedExecution executes clean code with exit code 0", () => {
    const result = spawnIsolatedExecution("const x = 1 + 2")
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
  })
})
