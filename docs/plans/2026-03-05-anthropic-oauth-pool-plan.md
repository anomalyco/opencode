# Anthropic OAuth Account Pool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the opencode-anthropic-auth plugin to rotate across multiple Claude Pro/Max OAuth accounts, switching when usage thresholds are breached or rate limits hit.

**Architecture:** Single-file plugin (`index.mjs`) gains pool state management, utilization header tracking, and reactive account switching inside the existing `fetch()` wrapper. A separate `add-account.mjs` script handles adding accounts to the pool file.

**Tech Stack:** JavaScript (ESM), OpenCode plugin API, Anthropic OAuth, Node.js `fs` for pool persistence.

**Design doc:** `docs/plans/2026-03-05-anthropic-oauth-pool-design.md`

**Plugin repo:** `sjawhar/opencode-anthropic-auth` (branch: `feat/oauth-context-cap`)
**Plugin entry:** `index.mjs` (~250 lines currently)

---

### Task 1: Pool State Module

Extract pool loading, saving, and account selection into functions at the top of `index.mjs`.

**Files:**

- Modify: `index.mjs` (add pool functions before `AnthropicAuthPlugin`)

**Step 1: Add pool constants and defaults**

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const POOL_PATH = join(homedir(), ".opencode", "data", "anthropic-pool.json")
const DEFAULTS = { cooldownMs: 300_000, threshold: 0.8 }
```

**Step 2: Add pool loading function**

```javascript
function loadPool() {
  if (!existsSync(POOL_PATH)) return null
  try {
    const raw = JSON.parse(readFileSync(POOL_PATH, "utf-8"))
    if (!raw.accounts?.length) return null
    return {
      accounts: raw.accounts.map((a) => ({
        label: a.label ?? "unnamed",
        refresh: a.refresh,
        access: "",
        expires: 0,
        util5h: 0,
        util7d: 0,
        cooloffUntil: 0,
      })),
      config: { ...DEFAULTS, ...raw.config },
    }
  } catch {
    return null
  }
}
```

**Step 3: Add pool persistence function**

Only called on account switch or process exit. Writes only labels, refresh tokens, and config — runtime state is not persisted.

```javascript
function savePool(pool) {
  const dir = join(homedir(), ".opencode", "data")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data = {
    accounts: pool.accounts.map((a) => ({
      label: a.label,
      refresh: a.refresh,
    })),
    config: pool.config,
  }
  writeFileSync(POOL_PATH, JSON.stringify(data, null, 2))
}
```

**Step 4: Add account selection function**

```javascript
function pickNext(pool, current) {
  const now = Date.now()
  const threshold = pool.config.threshold
  // First pass: not in cooloff and below threshold
  const candidates = pool.accounts.filter(
    (a) => a !== current && now >= a.cooloffUntil && Math.max(a.util5h, a.util7d) < threshold,
  )
  if (candidates.length) return candidates[0]
  // Second pass: not in cooloff, any utilization
  const available = pool.accounts.filter((a) => a !== current && now >= a.cooloffUntil)
  if (available.length) {
    available.sort((a, b) => Math.max(a.util5h, a.util7d) - Math.max(b.util5h, b.util7d))
    return available[0]
  }
  // All in cooloff: pick soonest to recover
  const all = pool.accounts.filter((a) => a !== current)
  if (!all.length) return current
  all.sort((a, b) => a.cooloffUntil - b.cooloffUntil)
  return all[0]
}
```

**Step 5: Commit**

```
jj describe -m "feat: add pool state module (load, save, select)"
jj new
```

---

### Task 2: Token Refresh for Pool Accounts

Extract token refresh into a standalone function that works with any pool account (not tied to opencode's auth store).

**Files:**

- Modify: `index.mjs`

**Step 1: Add refresh function for pool accounts**

```javascript
async function refreshToken(account) {
  const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: account.refresh,
      client_id: CLIENT_ID,
    }),
  })
  if (!response.ok) return false
  const json = await response.json()
  account.refresh = json.refresh_token
  account.access = json.access_token
  account.expires = Date.now() + json.expires_in * 1000
  return true
}
```

Note: Anthropic may return a new refresh token on each refresh. We update `account.refresh` in place and persist on next save.

**Step 2: Commit**

```
jj describe -m "feat: add standalone token refresh for pool accounts"
jj new
```

---

### Task 3: Verify Utilization Headers Exist

Before building the full pool integration, confirm that `anthropic-ratelimit-unified-5h-utilization` and `anthropic-ratelimit-unified-7d-utilization` headers actually appear in OAuth API responses. These headers are documented in GitHub issue #29721 but not in the official Anthropic rate-limits page.

**Step 1: Add temporary header logging to the existing plugin**

In the existing single-account `fetch()` wrapper, after `const response = await fetch(...)`, add:

```javascript
// TEMPORARY: verify utilization headers exist
for (const [k, v] of response.headers.entries()) {
  if (k.includes("ratelimit") || k.includes("utilization")) console.log(`[header] ${k}: ${v}`)
}
```

**Step 2: Make a few requests through opencode and check output**

Run opencode, send a message, check the console output. We need to see:
- `anthropic-ratelimit-unified-5h-utilization` (value 0.0-1.0)
- `anthropic-ratelimit-unified-7d-utilization` (value 0.0-1.0)

If these headers are NOT present: the proactive threshold switching won't work. The design still functions via 429-only reactive switching, but we should note this in the design doc and skip the threshold logic.

If they ARE present: proceed as designed.

**Step 3: Remove temporary logging and commit**

```
jj describe -m "chore: verify utilization headers present in OAuth responses"
jj new
```

---

### Task 4: Utilization Header Parsing

Add a function to read utilization headers from the response and update account state.

**Files:**

- Modify: `index.mjs`

**Step 1: Add header parsing function**

```javascript
function parseUtil(response, account) {
  const h5 = response.headers.get("anthropic-ratelimit-unified-5h-utilization")
  const h7 = response.headers.get("anthropic-ratelimit-unified-7d-utilization")
  if (h5 != null) account.util5h = parseFloat(h5)
  if (h7 != null) account.util7d = parseFloat(h7)
}
```

**Step 2: Commit**

```
jj describe -m "feat: add utilization header parsing"
jj new
```

---

### Task 5: Extract Request/Response Helpers

Factor existing fetch wrapper internals into reusable functions before wiring in pool mode. This is a pure refactor — behavior is unchanged.

**Files:**

- Modify: `index.mjs`

**Step 1: Extract `buildRequest(input, init, account)` helper**

Move the existing header construction, body transform (tool prefixing, sanitization), and URL manipulation into a standalone function that returns `{ requestInput, body, requestHeaders }`. Both the current single-account path and the future pool path will call it.

**Step 2: Extract `wrapStream(response)` helper**

Move the existing `ReadableStream` wrapper (that strips `mcp_` prefixes from tool names) into a standalone function.

**Step 3: Update the existing single-account fetch to use the new helpers**

Verify the plugin still works identically after the refactor.

**Step 4: Commit**

```
jj describe -m "refactor: extract buildRequest and wrapStream helpers"
jj new
```

---

### Task 6: Integrate Pool into the Fetch Wrapper
Modify the `auth.loader` to use the pool when available, falling back to single-account behavior when no pool file exists.

**Files:**

- Modify: `index.mjs` — the `auth.loader` function inside `AnthropicAuthPlugin`

**Step 1: Add pool initialization at the top of auth.loader**

At the beginning of the `loader` function (after `const auth = await getAuth()`), load the pool:

```javascript
const pool = loadPool()
```

If `pool` is null, fall through to the existing single-account logic unchanged.

**Step 2: Add pool-mode fetch wrapper**

When `pool` is not null AND `auth.type === "oauth"`, return a `fetch` that uses the pool instead of the single-account logic. The new fetch wrapper:

1. Uses `pool.accounts[0]` as the initial current account (held in closure)
2. Before request: ensure current account has valid access token (call `refreshToken` if expired)
3. Injects Bearer token from current account (same header logic as existing code)
4. All existing body transforms stay (tool prefixing, sanitization, beta headers)
5. After response: call `parseUtil(response, current)`
6. On 429: cooloff current, switch via `next()`, retry once
7. On threshold breach: switch via `next()` (no retry, takes effect next request)
8. On 401/403: clear access, attempt refresh, if fails cooloff + switch

The structure:

```javascript
if (pool) {
  // zero out cost (same as existing)
  for (const model of Object.values(provider.models)) {
    model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }
  }

  let current = pool.accounts[0]

  return {
    apiKey: "",
    async fetch(input, init) {
      // Ensure valid token
      if (!current.access || current.expires < Date.now()) {
        const ok = await refreshToken(current)
        if (!ok) {
          current.cooloffUntil = Date.now() + pool.config.cooldownMs
          current = pickNext(pool, current)
          savePool(pool)
          const ok2 = await refreshToken(current)
          if (!ok2) throw new Error("All accounts failed to refresh")
        }
      }

      // Build request (reuse existing header/body transform logic)
      const { requestInput, body, requestHeaders } = buildRequest(input, init, current)

      const response = await fetch(requestInput, {
        ...init,
        body,
        headers: requestHeaders,
      })

      // Parse utilization
      parseUtil(response, current)

      // Handle 429
      if (response.status === 429) {
        current.cooloffUntil = Date.now() + pool.config.cooldownMs
        const prev = current
        current = pickNext(pool, current)
        savePool(pool)
        if (current === prev) return response // no other accounts
        // Retry with new account
        if (!current.access || current.expires < Date.now()) {
          await refreshToken(current)
        }
        const retry = buildRequest(input, init, current)
        const r2 = await fetch(retry.requestInput, {
          ...init,
          body: retry.body,
          headers: retry.requestHeaders,
        })
        parseUtil(r2, current)
        return wrapStream(r2)
      }

      // Proactive switch on threshold
      if (Math.max(current.util5h, current.util7d) > pool.config.threshold) {
        const prev = current
        current = pickNext(pool, current)
        if (current !== prev) savePool(pool)
      }

      return wrapStream(response)
    },
  }
}
```

**Step 3: Commit**

```
jj describe -m "feat: integrate pool rotation into fetch wrapper"
jj new
```

---

### Task 7: Process Exit Persistence

Ensure pool state is saved when the process exits.

**Files:**

- Modify: `index.mjs`

**Step 1: Register exit handler**

Inside the pool-mode branch of `auth.loader`, after loading the pool:

```javascript
const onExit = () => {
  try {
    savePool(pool)
  } catch {}
}
process.on("beforeExit", onExit)
process.on("SIGTERM", onExit)
process.on("SIGINT", onExit)
```

This persists any updated refresh tokens (which may change on each refresh cycle) so they're available on next startup.

**Step 2: Commit**

```
jj describe -m "feat: persist pool state on process exit"
jj new
```

---

### Task 8: Add Account Script

Create `add-account.mjs` — standalone script that runs the PKCE OAuth flow and appends to the pool file.

**Files:**

- Create: `add-account.mjs`

**Step 1: Write the script**

```javascript
#!/usr/bin/env node
import { generatePKCE } from "@openauthjs/openauth/pkce"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const POOL_PATH = join(homedir(), ".opencode", "data", "anthropic-pool.json")

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    rl.question(q, (a) => {
      rl.close()
      resolve(a)
    }),
  )
}

async function main() {
  const label = await prompt("Account label (e.g. personal, work): ")
  const pkce = await generatePKCE()

  const url = new URL("https://claude.ai/oauth/authorize")
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback")
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", pkce.verifier)

  console.log("\nOpen this URL in your browser:\n")
  console.log(url.toString())
  const code = await prompt("\nPaste the authorization code here: ")

  const splits = code.split("#")
  const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
      code_verifier: pkce.verifier,
    }),
  })

  if (!result.ok) {
    console.error("Authorization failed:", result.status)
    process.exit(1)
  }

  const json = await result.json()
  const dir = join(homedir(), ".opencode", "data")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let pool = { accounts: [], config: {} }
  if (existsSync(POOL_PATH)) {
    try {
      pool = JSON.parse(readFileSync(POOL_PATH, "utf-8"))
    } catch {}
  }

  pool.accounts.push({ label: label.trim() || "unnamed", refresh: json.refresh_token })
  writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2))
  console.log(`\nAccount "${label}" added. Pool now has ${pool.accounts.length} account(s).`)
}

main()
```

**Step 2: Commit**

```
jj describe -m "feat: add standalone add-account script"
jj new
```

---

### Task 9: Manual Testing

**Step 1: Add one account via script**

```bash
node add-account.mjs
# Follow the OAuth flow, label it "test-1"
```

**Step 2: Verify pool file**

```bash
cat ~/.opencode/data/anthropic-pool.json
# Should show one account with label and refresh token
```

**Step 3: Add a second account**

```bash
node add-account.mjs
# Label it "test-2"
```

**Step 4: Start opencode and verify plugin loads pool**

Run opencode normally. Send a message. Confirm the plugin uses the first account (check that requests succeed).

**Step 5: Verify utilization tracking**

After a few requests, check that the plugin is reading utilization headers (add temporary `console.log` in `parseUtil` if needed).

**Step 6: Commit any fixes**

```
jj describe -m "fix: address issues found in manual testing"
jj new
```

---

### Task 10: Final Cleanup

**Step 1: Remove any debug logging**

**Step 2: Update the plugin README or add usage instructions**

Document:

- How to add accounts (manual edit or `add-account.mjs`)
- Pool file location and format
- Config options (cooldownMs, threshold)
- Fallback behavior when no pool file exists

**Step 3: Final commit**

```
jj describe -m "docs: add pool rotation usage instructions"
```
