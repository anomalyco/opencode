# 🔒 Security Audit Report — `anomalyco/opencode`
## Tanggal: 2026-06-13 | 2561 file TypeScript diaudit

---

## 🔴 CRITICAL (5 temuan)

### C1. No SSRF Protection in WebFetch Tool
**File:** `packages/core/src/tool/webfetch.ts:69-71`

```typescript
const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") 
    throw new Error("URL must use http:// or https://")
}
```

Tidak ada proteksi SSRF. Agent LLM bisa digunakan untuk:
- Akses `http://localhost`, `http://127.0.0.1`, `http://[::1]`
- Akses private IP ranges (10.x, 172.16.x, 192.168.x)
- Akses cloud metadata endpoint (`http://169.254.169.254/latest/meta-data/` → AWS IAM credentials)
- Akses GCP metadata (`http://metadata.google.internal/`)
- DNS rebinding attacks

**Fix:** Tambahkan validasi IP blocking:
```typescript
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", 
  "169.254.169.254", "metadata.google.internal"]
```

---

### C2. Hardcoded OAuth Client ID (Production OpenAI)
**File:** `packages/core/src/plugin/provider/openai-auth.ts:7`

```typescript
const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
```

Ini adalah production OpenAI client ID yang di-hardcode. Bisa dieksploitasi untuk:
- Phishing: attacker bikin halaman OAuth mirip punya OpenCode
- Memudahkan reverse engineering alur auth
- Supply chain fingerprinting

**Fix:** Pindahkan ke config/env, atau minimal dokumentasikan bahwa ini memang public dan by-design.

---

### C3. Bash Tool: Shell Berjalan dengan Host User Authority
**File:** `packages/core/src/tool/bash.ts:119, 97-102, 82-92`

```typescript
description: "Execute one shell command string with the host user's 
  filesystem, process, and network authority."
```

Fakta:
- Command dijalankan dengan **full host user authority** (filesystem + network + process)
- Proteksi `externalCommandDirectories()` cuma **advisory** ("this scan is advisory only"), bukan block
- TODO comment mengonfirmasi ini masih sementara:
  ```
  // TODO: Replace token-based command-argument external-directory 
  // advisories with parser-based detection.
  // TODO: Revisit process-group cleanup
  // TODO: Add durable/live progress metadata streaming
  ```

**Fix:** Implement parser-based path blocking (pakai tree-sitter bash/PowerShell), blokir command berbahaya (`curl http://169.254.169.254`, `cat ~/.ssh/id_rsa`, etc.)

---

### C4. Credential Disimpan di SQLite Tanpa Enkripsi
**File:** `packages/core/src/credential.ts`

OAuth tokens + API keys disimpan di SQLite lokal (`opencode-{channel}.db`) tanpa enkripsi at-rest. Siapa pun dengan filesystem access bisa membaca:

```typescript
// credential table schema (credential/sql.ts):
// id, integration_id, label, value (JSON: access_token + refresh_token), 
// time_created, time_updated
```

**Fix:** Implement SQLCipher atau encrypt `value` column dengan key derivation.

---

### C5. process.env Mutasi Global untuk Credential
**File:** `packages/core/src/plugin/provider/amazon-bedrock.ts:88`, `sap-ai-core.ts:17`

```typescript
// amazon-bedrock.ts
if (bearerToken && !process.env.AWS_BEARER_TOKEN_BEDROCK) 
  process.env.AWS_BEARER_TOKEN_BEDROCK = bearerToken

// sap-ai-core.ts  
if (serviceKey && !process.env.AICORE_SERVICE_KEY) 
  process.env.AICORE_SERVICE_KEY = serviceKey
```

Environment variable dimutasi secara global. Semua child process mewarisi credential ini.

**Fix:** Jangan mutate `process.env`. Gunakan scoped credential passing.

---

## 🟠 HIGH (5 temuan)

### H1. XSS di OAuth Error Page (Sanitasi Tidak Sempurna)
**File:** `packages/core/src/plugin/provider/openai-auth.ts:249-250`

```typescript
const errorPage = (message: string) =>
  `<!doctype html><title>OpenCode</title><h1>Authorization failed</h1>
   <p>${message.replace(/[&<>"']/g, "")}</p>`
```

Masalah:
- Backtick `` ` `` tidak di-filter → bisa dipakai untuk template injection
- Backslash `\` tidak di-filter → bisa escape context
- Tidak ada CSP / X-Frame-Options / X-Content-Type-Options header

**Fix:** Gunakan proper HTML escaping:
```typescript
const escapeHtml = (s: string) => s
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;")
  .replace(/`/g, "&#96;")
```

---

### H2. Share Session Secret Tanpa Rotasi & Rate Limiting
**File:** `packages/function/src/api.ts`

```typescript
public async share(sessionID: string) {
  let secret = await this.getSecret()
  if (secret) return secret  // ⚠️ Secret permanent, tidak pernah di-rotate!
  secret = randomUUID()
  await this.ctx.storage.put("secret", secret)
  return secret
}
```

- Secret sekali generate, berlaku selamanya
- Tidak ada rate limiting di `/share_sync`, `/share_delete`
- Tidak ada brute-force protection di `assertSecret()`
- Secret comparison string equality (`!==`), tidak constant-time

**Fix:** Implement TTL-based secret rotation, rate limiting, dan constant-time comparison.

---

### H3. Feishu Webhook Tanpa Signature Verification
**File:** `packages/function/src/api.ts` — endpoint `/feishu`

Tidak ada HMAC signature verification untuk Feishu webhook. Attacker bisa:
- Spoof webhooks dari Feishu
- Inject arbitrary messages ke Discord support channel
- Potensial SSRF via Discord message content

**Fix:** Verifikasi Feishu signing secret sebelum memproses payload.

---

### H4. Temp File Race Condition (Predictable Path)
**File:** `packages/core/src/models-dev.ts:163`

```typescript
const tempfile = `${filepath}.${process.pid}.${Date.now()}.tmp`
```

Path temporary predictable. Local attacker bisa symlink attack (TOCTOU).

**Fix:** Gunakan `crypto.randomUUID()` atau OS temp directory:
```typescript
import { tmpdir } from "os"
const tempfile = path.join(tmpdir(), `models-${crypto.randomUUID()}.tmp`)
```

---

### H5. Tidak Ada Prompt Injection Protection untuk Tool Output
Tidak ada sanitasi pipeline untuk output dari tool (`bash`, `webfetch`, `websearch`) sebelum dikirim kembali ke LLM. Attacker bisa:
- Host halaman web dengan prompt injection payload → LLM membaca via `webfetch` → prompt injection
- Command output (`bash`) yang mengandung teks adversarial
- Search result poisoning

**Fix:** Implement output sanitization layer atau tagging system (e.g., `<system>...</system>` wrapping).

---

## 🟡 MEDIUM (4 temuan)

### M1. `detached: true` Tanpa Process-Group Cleanup
**File:** `packages/core/src/tool/bash.ts:161-163`

```typescript
const command = ChildProcess.make(input.command, [], {
  cwd: target.canonical,
  shell,
  stdin: "ignore",
  detached: process.platform !== "win32",
  forceKillAfter: Duration.seconds(3),
})
```

`detached: true` berarti child process bisa survive parent exit (zombie processes). TODO di file mengkonfirmasi: `// TODO: Revisit process-group cleanup`.

**Fix:** Pastikan process-group tracking + cleanup untuk detached processes.

---

### M2. Permission Always Menyimpan Wildcard
**File:** `packages/core/src/permission.ts` + semua tool

Setiap tool yang pakai `permission.assert` menggunakan:
```typescript
save: ["*"],  // "Always allow" menyimpan wildcard!
```

User klik "Always" → semua future edit/write/bash di-approve tanpa scope.

**Fix:** Scope saved permissions ke resource spesifik, bukan `"*"`.

---

### M3. OAuth Callback Server Tanpa Rate Limiting
**File:** `packages/core/src/plugin/provider/openai-auth.ts:49-55`

Local server di port 1455 tidak punya:
- Rate limiting
- Connection timeout selain default Node
- Concurrent request limiting

**Fix:** Tambahkan connection limiting dan short timeouts.

---

### M4. FileSystem `die()` untuk Path Traversal
**File:** `packages/core/src/filesystem.ts:80-82`

```typescript
if (!FSUtil.contains(location.directory, absolute))
  return yield* Effect.die(new Error("Path escapes the location"))
```

Pakai `Effect.die` (unrecoverable) untuk handled error. Seharusnya `Effect.fail` (recoverable).

---

## 🟢 LOW / INFO (3 temuan)

### L1. Hardcoded Discord User ID
**File:** `packages/function/src/api.ts`
```typescript
message = message.replace(/^aiden,?\s*/i, "<@759257817772851260> ")
```
User ID Discord ter-hardcode. Informational leakage.

### L2. `marked` + `dompurify` di Dependencies tapi Tidak Digunakan di Core
`package.json` includes `dompurify: 3.3.1` dan `marked: 17.0.1`, tapi core tool output tidak di-sanitize sebelum dikirim ke model. Library ada tapi tidak dipakai di path kritis.

### L3. Test File Berisi OAuth Test Credentials
`packages/core/test/config/config.test.ts:315`
```typescript
oauth: { client_id: "client", scope: "read write", callback_port: 19876 }
```
Test credential — low risk karena cuma test file.

---

## 📊 SUMMARY

| Severity | Jumlah |
|----------|--------|
| 🔴 CRITICAL | 5 |
| 🟠 HIGH | 5 |
| 🟡 MEDIUM | 4 |
| 🟢 LOW / INFO | 3 |
| **Total** | **17** |

## 🎯 Prioritas Fix

1. **SSRF protection di WebFetch** — paling exploitable
2. **Bash sandbox escape hardening** — file/core impact  
3. **Credential encryption at-rest** — data protection
4. **OAuth XSS fix** — user-facing
5. **Feishu webhook signature verification** — remote exploitable
6. **Prompt injection defense** — model integrity
