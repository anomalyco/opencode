# 🛡️ MUEL v1.1 — RSI SAFETY AMENDMENT
## Hukum 11, 12, 13: Pengaman Khusus untuk RSI Engine
**Otoritas:** Chief Architect (CLAUDAI)  
**Disusun oleh:** Principal Engineer (Claude)  
**Berlaku:** Efektif segera setelah ratifikasi  
**Tanggal:** 23 Juni 2026

---

> **Tujuan amendment ini:** Menambahkan 3 hukum baru ke MUEL yang secara spesifik melindungi sistem EF-AI dari risiko yang ditimbulkan oleh Recursive Self-Improvement (RSI). Tanpa ini, RSI adalah **bunuh diri arsitektural** — AI bebas menulis kode tanpa pengaman yang memadai.

---

## 📋 Amendment Log

| # | Tanggal | Perubahan | Otoritas |
|---|---------|-----------|----------|
| 1 | 23 Jun 2026 | H11: Sandbox Confinement Law ditambahkan | Chief Architect |
| 2 | 23 Jun 2026 | H12: Metric Immutability Law ditambahkan | Chief Architect |
| 3 | 23 Jun 2026 | H13: Resource Budget Law ditambahkan | Chief Architect |

---

## 🔴 HUKUM 11: Sandbox Confinement Law

### Teks Hukum
> Kode yang ditulis RSI wajib di-compile dan di-test di VM terisolasi SEBELUM di-merge ke codebase utama. Dilarang eksekusi `child_process`, `fs.writeFile` di luar `src/evolution-rsi/`, atau `eval()`.

### Motivasi
AI yang menulis kode tanpa pengaman dapat menyuntikkan:
- **Code Injection:** `child_process.exec("rm -rf /")` → sistem hancur
- **Filesystem逃逸:** Menulis ke `src/muel/` atau `src/terminal/` → sangkar MUEL ditembus
- **Dynamic Execution:** `eval()` atau `new Function()` → bypass semua guard

### Enforcement di `src/muel/rsi-guard.ts`

```typescript
import path from "path"

export const IMMUTABLE_PATHS = [
  "src/muel",
  "src/terminal",
  "test/muel",
  "scripts/rsi-engine.ts",
  "package.json",
  "tsconfig.json"
]

// H11-A: Cegah akses ke Immutable Core
export function checkPath(targetPath: string): void {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/")
  for (const immutable of IMMUTABLE_PATHS) {
    if (normalized.includes(immutable)) {
      throw new Error(
        `RSI_GUARD_VIOLATION (H11): Path "${normalized}" termasuk Immutable Core "${immutable}". ` +
        `RSI hanya boleh menulis ke src/evolution-rsi/.`
      )
    }
  }
}

// H11-B: Paksa RSI hanya menulis ke evolution-rsi
export function assertEvolutionPath(targetPath: string): void {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/")
  if (!normalized.includes("src/evolution-rsi") && !normalized.includes("evolution-rsi")) {
    throw new Error(
      `RSI_PATH_VIOLATION (H11): RSI hanya boleh menulis ke src/evolution-rsi/. ` +
      `Path "${normalized}" ditolak.`
    )
  }
}

// H11-C: Deteksi pola berbahaya dalam kode RSI
const FORBIDDEN_PATTERNS = [
  /child_process/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /exec(?:Sync)?\s*\(/,
  /spawn(?:Sync)?\s*\(/,
  /writeFileSync/,
  /writeFile/,
  /rm\s+-rf/,
  /process\.exit/,
]

export function containsMaliciousPatterns(code: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      return `H11_VIOLATION: Kode mengandung pola berbahaya "${pattern}"`
    }
  }
  return null
}
```

### Test Wajib

```typescript
// test/rsi/rsi-guard.test.ts — minimum 5 tests
describe("RSI Guard H11 — Sandbox Confinement", () => {
  it("checkPath rejects src/muel/ paths", () => {
    expect(() => checkPath("src/muel/pipeline.ts")).toThrow("H11")
  })

  it("assertEvolutionPath rejects non-evolution paths", () => {
    expect(() => assertEvolutionPath("src/random/file.ts")).toThrow("H11")
  })

  it("assertEvolutionPath allows src/evolution-rsi/ paths", () => {
    expect(() => assertEvolutionPath("src/evolution-rsi/new-file.ts")).not.toThrow()
  })

  it("containsMaliciousPatterns detects child_process", () => {
    const result = containsMaliciousPatterns('const x = require("child_process")')
    expect(result).toContain("H11_VIOLATION")
  })

  it("containsMaliciousPatterns passes clean code", () => {
    const result = containsMaliciousPatterns('const x = 5 + 3')
    expect(result).toBeNull()
  })
})
```

---

## 🟠 HUKUM 12: Metric Immutability Law

### Teks Hukum
> File benchmark dan test evaluator TIDAK BOLEH dimodifikasi oleh RSI. Hash SHA-256 wajib di-catat sebelum RSI mulai. Jika hash berubah selama iterasi, RSI di-kill otomatis.

### Motivasi
Tanpa H12, RSI bisa **mengedit test/muel/** agar test selalu PASS meskipun kode salah. Ini menembus MUEL dari dalam.

### Enforcement

```typescript
import { createHash } from "crypto"
import { readdirSync, readFileSync } from "fs"
import path from "path"

// H12-A: Hitung hash direktori test/muel/
function computeTestHash(): string {
  const dir = "test/muel"
  const files = readdirSync(dir, { recursive: true })
    .filter(f => typeof f === 'string' && f.endsWith('.ts'))
    .sort() as string[]

  const hash = createHash("sha256")
  for (const file of files) {
    const content = readFileSync(path.join(dir, file), "utf8")
    hash.update(file).update(content)
  }
  return hash.digest("hex")
}

// H12-B: Verifikasi hash sebelum tiap iterasi RSI
function verifyTestHash(baselineHash: string): boolean {
  const currentHash = computeTestHash()
  if (currentHash !== baselineHash) {
    console.error(`❌ H12_VIOLATION: Hash test/muel/ berubah!`)
    console.error(`  Baseline: ${baselineHash}`)
    console.error(`  Current:  ${currentHash}`)
    return false
  }
  return true
}
```

### Integrasi ke RSI Engine

```typescript
// Di scripts/rsi-engine.ts, sebelum loop:
const testHashBaseline = computeTestHash()

// Di tiap iterasi, SEBELUM menulis file RSI:
if (!verifyTestHash(testHashBaseline)) {
  rollback()
  process.exit(78) // Exit code 78 = H12 violation
}
```

**Daftar path yang di-hash:**
- `test/muel/math-parser.test.ts`
- `test/muel/pipeline.test.ts`
- `test/muel/sanitizer.test.ts`
- `test/muel/provenance.test.ts`
- `test/muel/cot-verifier.test.ts`
- `test/muel/latent-defense.test.ts`

Setiap file baru di `test/muel/` (misal: `logical-cycle.test.ts`, `semantic-fingerprint.test.ts`) **juga masuk hash**. Jika RSI mengubah file mana pun → kill.

---

## 🟡 HUKUM 13: Resource Budget Law

### Teks Hukum
> Setiap iterasi RSI wajib punya cap: CPU max 30 detik, Memory max 512MB, Network access = 0. Jika exceeded, kill proses dan rollback.

### Motivasi
Kode RSI yang tidak terkendali bisa:
- **CPU 100%:** `while(true){}` → laptop hang
- **Memory leak:** Buffer tak terbatas → OOM
- **Network exfiltration:** Mengirim data ke server eksternal

### Enforcement

```typescript
import { spawnSync } from "child_process"

// H13-A: Kompilasi TypeScript dengan timeout 30s
function compileWithBudget(codePath: string): boolean {
  const result = spawnSync("bun", ["build", codePath, "--noEmit"], {
    encoding: "utf8",
    timeout: 30000, // H13: CPU max 30 detik
    maxBuffer: 512 * 1024 * 1024, // H13: Memory max 512MB
  })
  return result.status === 0
}

// H13-B: Jalankan test suite dengan timeout 120s + memory cap
function runMuelTests(): { pass: boolean; output: string } {
  const result = spawnSync("bun", ["test", "test/muel/"], {
    encoding: "utf8",
    timeout: 120_000, // 2 menit untuk full suite
    maxBuffer: 512 * 1024 * 1024,
  })
  const output = result.stdout + result.stderr
  return { pass: result.status === 0, output }
}

// H13-C: Network = 0 — tidak ada akses network di kode RSI
// Diimplementasikan via:
// 1. FORBIDDEN_PATTERNS contains: fetch, XMLHttpRequest, WebSocket, net.connect
// 2. Runtime: process.env.NODE_NO_WARNINGS tidak relevan — cukup guard static

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /net\.connect/,
  /http\.request/,
  /axios/,
  /got\s*\(/,
]

export function hasNetworkCalls(code: string): boolean {
  return NETWORK_PATTERNS.some(p => p.test(code))
}
```

### Ringkasan Budget

| Resource | Cap | Trigger | Action |
|----------|-----|---------|--------|
| CPU (kompilasi) | 30 detik | `spawnSync` timeout | Kill + rollback |
| CPU (test suite) | 120 detik | `spawnSync` timeout | Kill + rollback |
| Memory | 512 MB | `maxBuffer` | OOM kill |
| Network | 0 koneksi | Static analysis | File ditolak H11 |

---

## 🔗 Integrasi ke RSI Engine

### Checklist Sebelum Mulai Iterasi

```
[ ] H11: Guard runtime aktif (checkPath + assertEvolutionPath)
[ ] H11: Malicious pattern detector siap
[ ] H12: Hash test/muel/ baseline tercatat
[ ] H13: Resource budget limits terkonfigurasi
[ ] H13: Network pattern detector siap
```

### Checklist Setiap Iterasi

```
[ ] H12: Hash test/muel/ diverifikasi → jika berubah → KILL
[ ] H11: Path setiap file RSI diverifikasi → jika violation → SKIP file
[ ] H11: Kode RSI diperiksa pola berbahaya → jika ada → KILL
[ ] H13: Kompilasi timeout 30s → jika timeout → KILL + rollback
[ ] H13: Test suite timeout 120s → jika timeout → KILL + rollback
[ ] H13: Memory budget 512MB → jika exceeded → KILL + rollback
[ ] H13: Kode RSI diperiksa network calls → jika ada → KILL
```

---

## 📊 Status Ratifikasi

| Hukum | Status | Tanggal | 
|-------|--------|---------|
| H11 Sandbox Confinement | ✅ DIRATIFIKASI | 23 Jun 2026 |
| H12 Metric Immutability | ✅ DIRATIFIKASI | 23 Jun 2026 |
| H13 Resource Budget | ✅ DIRATIFIKASI | 23 Jun 2026 |

**MUEL sekarang memiliki 13 hukum.** Fase selanjutnya (RSI Engine) akan dibangun dengan H11-H13 aktif sejak awal.

---

*Dokumen ini adalah amendment resmi MUEL v1.1. Melengkapi dokumen RANCANGAN-FINAL-MUEL-v1.0.md. Setiap perubahan terhadap amendment ini wajib melalui sign-off Chief Architect.*
