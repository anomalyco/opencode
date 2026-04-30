# `@opencode-ai/telemetry`

Tiny telemetry + update-check SDK shared by the three opencode clients (CLI / desktop / web).

> **Status:** Phase C1 skeleton (workflow doc §3). This package is a workspace dependency intended to be consumed by `packages/opencode`, `packages/desktop-electron`, and `packages/app`. It does **not** wire itself into any client — that's tracked in C2 / C3 / C4.

---

## What this package does

1. **Heartbeat / event tracking** — buffered POSTs to a self-hosted Plausible endpoint (`telemetry.deskfox.ai`).
2. **Update check** — `GET https://updates.deskfox.ai/v1/latest/<client>/latest.json`, with a 24-hour local cache.
3. **First-run notice** — returns notice text once per install; the host UI decides how to display it.
4. **Opt-out resolution** — env > flag > config-file > default(true). Independent toggle for update checks.

It deliberately uses **only Bun / Node stdlib + `semver`**. No `effect`, no Hono, no Zod — keeps the SDK small enough to be safely loaded on every CLI start without slowing it down.

---

## Public API

```ts
import { init } from "@opencode-ai/telemetry"

const telemetry = await init({
  clientType: "cli",      // "cli" | "desktop" | "web"
  appVersion: "1.2.3",
  disableFlag: false,     // optional, true = --no-telemetry passed
  // configPath, endpoints, fetchImpl, cacheDir, installIdDir all optional
})

// Show the notice once on first run.
const notice = await telemetry.firstRunNoticeIfNeeded()
if (notice) process.stderr.write(notice + "\n")

// Heartbeat — pageview-equivalent for DAU.
telemetry.heartbeat()

// Custom event (one of the L4-lite event names).
telemetry.track("cli.tool_run")

// Update check (returns null on full failure / disabled).
const update = await telemetry.checkUpdate()
if (update?.hasUpdate) {
  process.stderr.write(`Update available: ${update.latest}\n`)
  if (update.upgradeCommand) {
    process.stderr.write(`Run: ${update.upgradeCommand}\n`)
  }
}

// On exit:
await telemetry.flush()
```

### Disabling

Any one of these turns telemetry off (priority highest → lowest):

| Method | Example |
|---|---|
| ENV | `OPENCODE_TELEMETRY=0` (also `false`, `no`, `off`) |
| Init flag | `init({ ..., disableFlag: true })` (CLI: `--no-telemetry`) |
| Config | `~/.config/opencode/config.json` → `{ "telemetry": false }` |
| Default | `true` (telemetry on) |

The update check has its own switch: `OPENCODE_UPDATE_CHECK=0` or `{ "update_check": false }` in the config file.

When telemetry is disabled, `track()` / `heartbeat()` / `flush()` are zero-cost no-ops — no `fetch` is initiated.

---

## Module layout

```
src/
├── index.ts          # init(); re-exports the rest
├── install_id.ts     # lazy UUIDv4 in ~/.cache/opencode/install_id (mode 0600)
├── config.ts         # opt-out resolution
├── transport.ts      # buffered fetch + 5min/20-event flush + retries (1s/2s/4s)
├── update_check.ts   # 24h-cached GET + detectInstallMethod() for the CLI
├── notice.ts         # first-run notice text + marker file
└── types.ts
```

### Install ID — why `~/.cache/`, not `~/.config/`

Per design risk **R-5** in `docs/design-telemetry-and-update.md`: cloud-sync tools (Dropbox, OneDrive, iCloud) often sync `~/.config/` but skip `~/.cache/`. Storing `install_id` in cache prevents the same UUID from showing up across multiple machines, which would inflate DAU.

The file is created with mode `0600` on POSIX. On Windows we still write the file but skip the chmod (Windows ACLs handle this differently).

### Cross-platform note

For simplicity we always use `~/.cache/opencode/` on every platform — including Windows, where the conventional cache dir is `%LOCALAPPDATA%`. This keeps the SDK trivial and matches the existing convention used elsewhere in the opencode codebase. Windows users will end up with `%USERPROFILE%\.cache\opencode\install_id`.

---

## Event schema

Every event sent to Plausible carries:

```json
{
  "name": "<event name>",
  "url": "app://launch | app://event",
  "domain": "opencode.cli | opencode.desktop | opencode.web",
  "props": {
    "version": "1.2.3",
    "install_id": "<uuid v4>",
    "os": "linux | darwin | win32",
    "arch": "x64 | arm64"
  }
}
```

The transport sets `User-Agent: opencode-<client>/<version> (<os>; <arch>; install=<short-id>)`.

> **Never sent**: file paths, prompt content, model names, or any user-identifying data. See design §6.2.

---

## Tests

```
cd packages/telemetry
bun test
```

The tests run with Bun's built-in test runner and cover:

- `install_id.test.ts` — first-create / second-read / corrupted-file regen / mode 0600 (POSIX) / nested-dir create
- `config.test.ts` — env > flag > config > default priority chain (both telemetry and update-check switches)
- `transport.test.ts` — opt-out short-circuit / buffer flush / size threshold auto-flush / retry-then-give-up / failure-doesn't-throw
- `update_check.test.ts` — cache hit / cache miss / stale cache / network failure / `hasUpdate` semver compare / `upgradeCommand` lookup

All tests inject mocks for `fetch` — no real network calls.

---

## Open decisions / deviations from the design doc

These were made by the Phase C1 implementor; flag any you want changed:

1. **Package name** = `@opencode-ai/telemetry` (matches existing `@opencode-ai/*` convention in the workspace; the original spec listed `@opencode/telemetry` as a possibility).
2. **No `effect` dependency.** The rest of the workspace uses `effect` heavily, but per the C1 brief this package stays plain TS to keep startup overhead low.
3. **`install_id` lives in `~/.cache/opencode/`** on every platform (including Windows). The design doc text said `.cache` but originally illustrated `.config`; we picked cache to honor risk R-5.
4. **Notice marker** lives in `~/.config/opencode/.telemetry_notice_shown`, separately from the install_id (which is in `.cache`). The marker is preference-like, so config dir is fine.
5. **`init()` is async** because we read `config.json` and `install_id` eagerly. Clients should `await init(...)` once at startup.
6. **`detectInstallMethod()` is implemented here** (lives with `update_check.ts`) so the CLI can re-use it without reimplementing it in C2.6.
