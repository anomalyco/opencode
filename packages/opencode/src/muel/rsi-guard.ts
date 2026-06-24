import path from "path"
import crypto from "crypto"
import fs from "fs"

export const IMMUTABLE_PATHS = [
  "src/muel",
  "src/terminal",
  "test/muel",
  "test/rsi",
  "script/rsi-spawner.ts",
  "scripts/rsi-engine.ts",
  "package.json",
  "tsconfig.json",
]

const MALICIOUS_PATTERNS = [
  /\bchild_process\b/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /exec(?:Sync)?\s*\(/,
  /spawn(?:Sync)?\s*\(/,
  /writeFileSync/,
  /writeFile\s*\(/,
  /rm\s+-rf/,
  /process\.exit/,
  /process\.kill/,
  /process\.abort/,
]

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /net\.connect/,
  /http\.request/,
  /axios/,
  /got\s*\(/,
]

const PROTOTYPE_PATTERNS = [
  /__proto__/,
  /Object\.prototype/,
  /Function\.prototype/,
  /Array\.prototype/,
  /String\.prototype/,
  /constructor\s*\[/,
  /\.__defineGetter__/,
  /\.__defineSetter__/,
]

const FORBIDDEN_IMPORTS = [
  /worker_threads/,
  /\bcluster\b/,
  /\bchild_process\b/,
  /\bdns\b/,
  /\bnet\b/,
  /\bhttp\b/,
  /\bhttps\b/,
]

export const RSIGUARD_SRC = __filename

export function checkPath(targetPath: string): void {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/")
  for (const immutable of IMMUTABLE_PATHS) {
    if (normalized.includes(immutable)) {
      throw new Error(
        `RSI_GUARD_VIOLATION (H11): Path "${normalized}" includes Immutable Core "${immutable}". ` +
        `RSI only allowed to write to src/evolution-rsi/.`
      )
    }
  }
}

export function assertEvolutionPath(targetPath: string): void {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/")
  if (!normalized.includes("src/evolution-rsi") && !normalized.includes("evolution-rsi")) {
    throw new Error(
      `RSI_PATH_VIOLATION (H11): RSI only allowed to write to src/evolution-rsi/. ` +
      `Path "${normalized}" rejected.`
    )
  }
}

function decodeHexEscapes(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function decodeUnicodeEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

const BASE64_PATTERN = /Buffer\.from\(['"]([A-Za-z0-9+/=]+)['"]\s*,\s*['"]base64['"]\)/g

function extractBase64FromBuffer(code: string): string[] {
  const decoded: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(BASE64_PATTERN)
  while ((match = re.exec(code)) !== null) {
    try {
      const raw = Buffer.from(match[1], "base64").toString("utf8")
      if (raw.length > 0) decoded.push(raw)
    } catch {}
  }
  return decoded
}

export function deobfuscateCode(code: string): string[] {
  const results: string[] = []

  const decodedBase64 = extractBase64FromBuffer(code)
  results.push(...decodedBase64)

  const hexDecoded = decodeHexEscapes(code)
  if (hexDecoded !== code) results.push(hexDecoded)

  const unicodeDecoded = decodeUnicodeEscapes(code)
  if (unicodeDecoded !== code) results.push(unicodeDecoded)

  const combined = decodeUnicodeEscapes(decodeHexEscapes(code))
  if (combined !== code) results.push(combined)

  return [...new Set(results)]
}

function scanCode(code: string): string | null {
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(code)) {
      return `H11_VIOLATION: Code contains forbidden pattern "${pattern}"`
    }
  }
  return null
}

function scanObfuscated(code: string): string | null {
  const decoded = deobfuscateCode(code)
  for (const layer of decoded) {
    for (const pattern of MALICIOUS_PATTERNS) {
      if (pattern.test(layer)) {
        return `OBFUSCATED_MALICIOUS_PATTERN: Code contains obfuscated forbidden pattern "${pattern}"`
      }
    }
  }
  return null
}

export function containsMaliciousPatterns(code: string): string | null {
  const directHit = scanCode(code)
  if (directHit) return directHit
  return scanObfuscated(code)
}

export function containsMaliciousPatternsRaw(code: string): string | null {
  return scanCode(code)
}

export function computeTestHash(): string {
  const dir = "test/muel"
  const files: string[] = []
  try {
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (full.endsWith(".ts")) files.push(full)
      }
    }
    walk(dir)
  } catch {
    return ""
  }
  files.sort()
  const hash = crypto.createHash("sha256")
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    hash.update(path.relative(dir, file)).update(content)
  }
  return hash.digest("hex")
}

export function verifyTestHash(baselineHash: string): boolean {
  const current = computeTestHash()
  return current === baselineHash
}

export function compileWithBudget(codePath: string): boolean {
  const result = Bun.spawnSync(["bun", "build", codePath, "--noEmit"], {
    env: { ...process.env },
    timeout: 30000,
  })
  return result.exitCode === 0
}

export function runMuelTests(): { pass: boolean; output: string } {
  const result = Bun.spawnSync(["bun", "test", "test/muel/"], {
    env: { ...process.env },
    timeout: 120_000,
  })
  const output = result.stdout.toString() + result.stderr.toString()
  return { pass: result.exitCode === 0, output }
}

export function hasNetworkCalls(code: string): boolean {
  return NETWORK_PATTERNS.some(p => p.test(code))
}

export function containsPrototypePollution(code: string): string | null {
  for (const pattern of PROTOTYPE_PATTERNS) {
    if (pattern.test(code)) {
      return `H11_VIOLATION: Code contains prototype pollution pattern "${pattern}"`
    }
  }
  return null
}

export function containsBlockedImports(code: string): string | null {
  for (const pattern of FORBIDDEN_IMPORTS) {
    if (pattern.test(code)) {
      return `H11_VIOLATION: Code contains blocked import "${pattern}"`
    }
  }
  return null
}

export function checkNamespaceCollision(filePath: string): string | null {
  const name = path.basename(filePath, path.extname(filePath))
  for (const immutable of IMMUTABLE_PATHS) {
    const dirName = path.basename(immutable)
    if (name === dirName) {
      return `H11_VIOLATION: Filename "${name}" collides with Immutable Core namespace "${immutable}"`
    }
  }
  return null
}

export function sanitizeEnv(): void {
  const sensitive = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"]
  for (const key of Object.keys(process.env)) {
    if (sensitive.some(s => key.toUpperCase().includes(s))) {
      delete process.env[key]
    }
  }
}

export function exterminateTimers(): void {
  let id = 1
  while (id <= 1000) {
    clearTimeout(id as unknown as NodeJS.Timeout)
    clearInterval(id as unknown as NodeJS.Timeout)
    id++
  }
}

export interface SnapshotEntry {
  path: string
  type: "file" | "dir"
}

export function snapshotWorkspace(baseDir: string = "."): SnapshotEntry[] {
  const entries: SnapshotEntry[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(baseDir, full).replace(/\\/g, "/")
      if (rel.startsWith("node_modules") || rel.startsWith(".git")) continue
      entries.push({ path: rel, type: entry.isDirectory() ? "dir" : "file" })
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(baseDir)
  return entries
}

export function restoreWorkspace(before: SnapshotEntry[], codeDir: string, baseDir: string = "."): string[] {
  const removed: string[] = []
  const allowedPrefixes = [codeDir.replace(/\\/g, "/")]

  const beforePaths = new Set(before.map(e => e.path))
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(baseDir, full).replace(/\\/g, "/")
      if (rel.startsWith("node_modules") || rel.startsWith(".git")) continue
      if (!beforePaths.has(rel)) {
        if (allowedPrefixes.some(p => rel.startsWith(p))) continue
        fs.rmSync(full, { recursive: true, force: true })
        removed.push(rel)
      } else if (entry.isDirectory()) {
        walk(full)
      }
    }
  }
  walk(baseDir)
  return removed
}

export function detectConvergence(history: number[], threshold: number = 3): { converged: boolean; plateauCount: number } {
  if (history.length < threshold + 1) return { converged: false, plateauCount: 0 }
  let plateau = 0
  const recent = history.slice(-(threshold + 1))
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] <= recent[i - 1]) plateau++
    else plateau = 0
  }
  return { converged: plateau >= threshold, plateauCount: plateau }
}

export function trackMemoryDelta(history: number[], maxDeltaMB: number = 50, windowSize: number = 3): { leak: boolean; delta: number } {
  if (history.length < 2) return { leak: false, delta: 0 }
  const baseline = history[0]
  const latest = history[history.length - 1]
  const delta = latest - baseline
  return { leak: delta > maxDeltaMB && history.length >= windowSize, delta }
}

export function computeSelfHash(): string {
  const content = fs.readFileSync(RSIGUARD_SRC, "utf8")
  return crypto.createHash("sha256").update(content).digest("hex")
}

const RSI_TEMP_DIR = path.resolve("src", "evolution-rsi", ".rsi-cache")

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export function spawnIsolatedExecution(code: string, args: string[] = []): SpawnResult {
  const bunPath = process.execPath
  const proc = Bun.spawnSync([bunPath, "-e", code, ...args], {
    env: { NODE_ENV: "isolated" },
    timeout: 30000,
  })

  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()

  return {
    stdout,
    stderr,
    exitCode: proc.exitCode,
    timedOut: proc.signalCode === "SIGKILL",
  }
}
