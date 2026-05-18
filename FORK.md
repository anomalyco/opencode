# Fork-Specific Features (dzianisv/opencode)

This document tracks custom features added to this fork that are **not present upstream**.
Use this as a checklist after every rebase on `upstream/dev` to verify nothing was lost.

---

## ✅ Recovered after rebase regression (2026-05-11)

Source refs:
- `dev-backup-20260509-031153`
- `7e2b59d82` (voice controls + Edge TTS integration)
- `b04367638` (recently active model/session UX baseline)

Recovered fixes:
- Restored browser STT controls in `packages/app/src/components/prompt-input.tsx` (mic capture + transcript insertion into prompt).
- Restored assistant TTS auto-play path in `packages/app/src/pages/session/message-timeline.tsx` using `/tts/edge` with browser speech-synthesis fallback.
- Restored required runtime guards in `packages/app/src/utils/runtime-adapters.ts` (media devices, permissions, speech synthesis).
- Restored model picker recent-group behavior/wiring in `packages/app/src/components/dialog-select-model.tsx` (recent ordering/grouping without duplicated entries).

## ✅ Recovered backend regressions (issue #190, 2026-05-11)

Source refs:
- `dev-backup-20260509-031153`
- `7aaa1cb90` (`feat(tools): add rename tool for AI-driven session naming`)
- `760b20fbd` (`fix: enforce PR naming rule in rename tool`)

Recovered fixes:
- Restored `packages/opencode/src/tool/rename.ts` in the Effect-based tool framework with tool id `rename` and session title updates via `Session.Service.setTitle`.
- Re-registered `rename` in `packages/opencode/src/tool/registry.ts` (init + built-in tool list).
- Restored concise session naming guidance in `packages/opencode/src/session/system.ts` so agents rename early once task scope is clear.

## ✅ Recovered memory-leak hardening (2026-05-11)

Source refs:
- `dev-backup-20260509-031153`
- `54386d715` (backup memory leak hardening baseline)

Recovered fixes:
- Restored `AsyncQueue` lifecycle hardening in `packages/opencode/src/util/queue.ts` (`close()`, `drain()`, `isClosed`, and closed-state consumer release).
- Switched OAuth browser-open subprocess listeners to one-shot handlers in `packages/opencode/src/mcp/index.ts` (`once("error")`, `once("exit")`) to prevent listener accumulation.
- Added explicit typed pubsub map cleanup in `packages/opencode/src/bus/index.ts` finalizer (`typed.clear()` after shutdown).

## ✅ Recovered local install flow regression (2026-05-11)

Source refs:
- `dev-backup-20260509-031153`
- `28c748879` (`fix: restore local install flow (#46)`)

Recovered fixes:
- Restored root `install:local` script in `package.json` delegating to `packages/opencode`.
- Restored local install pipeline scripts in `packages/opencode/package.json` (`build:local`, `sign:local`, `copy:local`, `install:local`).
- Restored `packages/opencode/script/sign-local.ts` and `packages/opencode/script/install-local.ts` to keep local binary copy + ad-hoc codesigning reproducible.

## ⚠️ Rebase Survival Checklist

After rebasing on `upstream/dev`, verify each feature still works:

### 1. Recently Used Models in Model Picker

**Files:** `packages/app/src/components/dialog-select-model.tsx`

- The model picker dialog shows a **"Recently Used"** group at the top
- Recent models are sourced from `model.recent?.()` in the models context
- A `recents` map keyed by `provider:id` is used to keep recents ordered and de-duplicated
- The "Recently Used" group is always pinned first via `sortGroupsBy`

**How to verify:** Open model picker (Cmd+M or the model button) → you should see "Recently Used" group at the top with previously used models.

### 2. Project Labels in Recent Sessions Sidebar

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionRow` renders `prefix` label under session title
- `packages/app/src/pages/layout/sidebar-recent.tsx` — passes `prefixes` from `organizeRecentSessions()` to `SessionItem`
- `packages/app/src/utils/recent-session.ts` — `organizeRecentSessions()` computes prefix map

**How to verify:** Open the recent sessions sidebar → sessions from different projects should show the project/workspace name as a small label under the session title.

### 3. Hide Orphan Child Sessions from Recent Roots

**Files:** `packages/app/src/utils/recent-session.ts` (line ~84)

- The `organizeRecentSessions()` roots filter MUST be `.filter((session) => !session.parentID)`
- Sessions with a `parentID` should NEVER appear as top-level roots, even if their parent is missing/archived
- This fix has been lost **3 times** during rebases — the incorrect version adds `|| !lookup.has(session.parentID)` which promotes orphans to roots

**How to verify:** If a child session's parent is archived or outside the fetch limit, it should NOT appear in the Recent tab at all.

**⚠️ REBASE DANGER:** Upstream or conflict resolution may re-introduce `|| !lookup.has(session.parentID)` — this is WRONG for our use case. Always check this line after rebase.

### 4. Collapsible Parent/Child Session Tree

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionItem` renders child sessions recursively with depth-based indentation and collapse/expand chevron toggle
- `packages/app/src/pages/layout/sidebar-recent.tsx` — passes `children` map to `SessionItem`
- `packages/app/src/pages/layout/sidebar-project.tsx` — passes `children` map via `childMapByParent()`
- `packages/app/src/pages/layout/sidebar-workspace.tsx` — passes `children` map via `childMapByParent()`
- `packages/app/src/pages/layout/helpers.ts` — `childMapByParent()` builds parent→child ID map

**How to verify:** Sessions with subagents should show nested under their parent with a collapse chevron. Clicking the chevron folds/unfolds children.

### 4. Session Hover Preview (HoverCard with Messages)

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionHoverPreview` component wraps `SessionRow` in a `HoverCard` showing user messages via `MessageNav`

**How to verify:** Hover over a session in the sidebar for ~1 second → a preview card should appear showing the session's user messages.

### 5. workspaceKey Helper (replaces pathKey)

**Files:**
- `packages/app/src/pages/layout/helpers.ts` — `workspaceKey()` normalizes workspace directory paths (handles Windows paths, trailing slashes, drive letters)
- Used in `sidebar-workspace.tsx` and `helpers.ts` instead of `pathKey` from `@/utils/path-key`

### 6. `/recent` Route and Navigation

**Files:**
- `packages/app/src/app.tsx` — lazy `RecentRoute` import and `/recent` route (MUST be before `/:dir` catch-all)
- `packages/app/src/pages/layout.tsx` — `RecentTile` onClick calls `navigate("/recent")`
- `packages/app/src/pages/layout/sidebar-recent.tsx` — slug uses `base64Encode(session.directory)` (NOT hardcoded `"recent"`)
- `packages/app/src/pages/layout/sidebar-items.tsx` — message hover navigate uses absolute path with leading `/`

**How to verify:**
1. Click "Recent sessions" tile on home page → URL changes to `/recent`, main content shows "Recently Active" page
2. Click any session in the recent sidebar → URL is `/<base64dir>/session/<sessionId>`, session content loads
3. Hover a session → hover preview shows messages; clicking a message navigates to the correct session

### 7. Session Auto-Title and Rename

**Files:**
- `packages/opencode/src/session/prompt.ts` — `ensureTitle()` at line ~170, called on step 1 (first assistant response)
- `packages/opencode/src/agent/agent.ts` — built-in "title" agent definition (line ~261)
- `packages/opencode/src/agent/prompt/title.txt` — title generation system prompt
- `packages/app/src/pages/session/message-timeline.tsx` — `titleMutation`, `openTitleEditor()`, "Rename" dropdown item

**How to verify:**
1. Send a message in a new session → after first assistant response, session title should auto-update from "New session - ..." to a generated title
2. Open "More options" dropdown on a session → "Rename" item appears → clicking opens inline title editor
3. If auto-title fails, check that the configured provider has a working "small" model available

### 8. Voice Support (STT + TTS)

**Files:**
- `packages/app/src/components/prompt-input.tsx` — mic input (STT) and speaker toggle controls
- `packages/app/src/pages/session/message-timeline.tsx` — assistant auto-speak playback flow
- `packages/app/src/utils/runtime-adapters.ts` — browser speech/media adapter guards
- `packages/app/src/context/settings.tsx` — `voice.autoSpeak` setting
- `packages/opencode/src/server/routes/tts.ts` — `/tts/edge` endpoint

**How to verify:**
1. Prompt toolbar shows mic/speaker controls in supported browsers
2. Mic input inserts transcript text into prompt
3. Assistant playback calls `/tts/edge` and falls back to browser speech synthesis if needed

### 9. Session Rename Tool (Agent-Side)

**Files:**
- `packages/opencode/src/tool/rename.ts` — `rename` tool implementation
- `packages/opencode/src/tool/registry.ts` — `rename` tool registration
- `packages/opencode/src/session/system.ts` — session naming guidance in system prompt

**How to verify:** In an agent session, tool list includes `rename`, and session titles are updated early in task flow.

### 10. Auto-Resume on Serve

**Files:**
- `packages/opencode/src/cli/cmd/serve.ts` — `autoresume()` function dedupes sessions and resumes by recency

**How to verify:** Start `opencode serve`, sessions with pending questions should auto-resume.

### 11. Multi-Instance Serve

**Files:**
- `packages/opencode/src/cli/cmd/serve.ts` — `OPENCODE_INSTANCE_MAX` env var support

**How to verify:** Env var `OPENCODE_INSTANCE_MAX=16` is respected in systemd service config.

### 12. Memory Leak Hardening (Queue + MCP + Bus)

**Files:**
- `packages/opencode/src/util/queue.ts` — `AsyncQueue.close()`, `drain()`, `isClosed`, and safe closed-state async iteration behavior
- `packages/opencode/src/mcp/index.ts` — one-shot subprocess listeners for OAuth browser open flow
- `packages/opencode/src/bus/index.ts` — finalizer clears typed pubsub map after shutdown

**How to verify:**
1. `cd packages/opencode && bun typecheck`
2. `bun test test/util/queue.test.ts`
3. `bun test test/server/httpapi-mcp-oauth.test.ts`
4. `bun test test/bus/bus.test.ts`

### 13. Local install script + macOS signing

**Files:**
- `package.json` — root `install:local` script delegates to `packages/opencode`
- `packages/opencode/package.json` — local pipeline scripts (`build:local`, `sign:local`, `copy:local`, `install:local`)
- `packages/opencode/script/sign-local.ts` — ad-hoc signs the local dist binary on macOS
- `packages/opencode/script/install-local.ts` — copies binary to `~/.local/bin/opencode`, signs again on macOS, and verifies signature

**How to verify:**
1. `npm run install:local`
2. `codesign --verify --verbose=4 ~/.local/bin/opencode` (macOS)
3. `~/.local/bin/opencode --version`

### 14. Auto-Review (Supervisor + Cross-Review)

**Files:**
- `packages/opencode/src/config/config.ts` — `auto_review` config field (optional `model` in `provider/model` format)
- `packages/app/src/context/settings.tsx` — `models` section: `autoReview` toggle, `defaultModel`, `reviewModel`
- `packages/app/src/pages/session.tsx` — orchestration loop: supervisor → summarize → cross-review with retry cap
- `packages/app/src/pages/session/auto-review.ts` — prompt generation, model picking, done-token detection

**How to verify:**
1. Enable "Auto Review" in Settings → Models
2. Send a coding task; after the assistant completes, a supervisor review followup auto-queues
3. After supervisor review completes and summarization, a cross-review followup queues with a different model
4. Review stops after "Task completed." token or after 3 retries per phase

---

## 🧪 Post-Rebase Browser Smoke Test

After every rebase + deploy, run through this checklist in the browser:

| # | Test | Expected |
|---|------|----------|
| 1 | Navigate to `/` | Home page loads with "Recent projects" tiles |
| 2 | Click "Recent sessions" tile | URL → `/recent`, main content shows "Recently Active" with session list |
| 3 | Click "Recent sessions" sidebar button | Sidebar switches to recent sessions panel |
| 4 | Click a session in recent sidebar | URL → `/<base64dir>/session/<id>`, session messages load |
| 5 | Click a project tile on home page | Project's session list loads, sidebar shows project sessions |
| 6 | Open model picker (model button) | "Recently Used" group appears at top |
| 7 | Hover a session in sidebar | Preview card shows user messages |
| 8 | Check parent/child sessions | Subagent sessions nested under parent with collapse chevron |
| 9 | Check session labels in recent sidebar | Project/workspace labels shown under session titles |
| 10 | Open "More options" on a session | "Rename" option present; clicking opens inline editor |
| 11 | Send a message in new session | After first response, title auto-updates from "New session - ..." |
| 12 | Verify back/forward navigation | Browser back/forward buttons work between sessions |
| 13 | Toggle speaker control in prompt | Auto-speak setting toggles and current playback stops when disabled |
| 14 | Trigger voice playback and STT | Mic capture inserts text; `/tts/edge` returns playable audio for assistant speech |
| 15 | Enable auto-review in Settings → Models | Toggle persists; after assistant completes, supervisor review auto-queues |

---

## Common Rebase Conflict Zones

These files are frequently modified by both upstream and this fork. Pay extra attention:

| File | Risk | What to watch for |
|------|------|-------------------|
| `recent-session.ts` | **HIGH** | Roots filter MUST be `!session.parentID` only — NO `\|\| !lookup.has(...)` |
| `sidebar-items.tsx` | **HIGH** | `SessionItemProps` type, `SessionRow`, `SessionItem`, `SessionHoverPreview` |
| `sidebar-recent.tsx` | **HIGH** | Props passed to `SessionItem` (children, lookup, prefixes, popover) |
| `layout.tsx` | **HIGH** | `RecentSidebarPanel` wiring, `/recent` navigation, and `recentSessionProps.collapsible = true` |
| `sidebar-project.tsx` | MEDIUM | `childMapByParent` usage, `sessionProps` Omit type, `setHoverSession` |
| `sidebar-workspace.tsx` | MEDIUM | `childMapByParent` usage, `workspaceKey` import, removed `useIsFetching` |
| `helpers.ts` | MEDIUM | `childMapByParent()`, `workspaceKey()` functions |
| `dialog-select-model.tsx` | LOW | Recently used models grouping logic |
| `prompt-input.tsx` | **HIGH** | STT controls, mic permission flow, transcript insertion |
| `message-timeline.tsx` | **HIGH** | TTS playback, stale-request cancellation, mute behavior |
| `settings.tsx` | MEDIUM | `voice.autoSpeak` defaulting and persistence; `models` section for auto-review |
| `session.tsx` | **HIGH** | Auto-review `createEffect`, `ReviewState`, followup store fields (`autoReview`, `review`, `pending`) |
| `package.json` | **HIGH** | root `install:local` script should delegate to `packages/opencode` |
| `packages/opencode/package.json` | **HIGH** | keep `build:local` / `sign:local` / `copy:local` / `install:local` scripts |
| `packages/opencode/script/install-local.ts` | **HIGH** | local binary copy target (`~/.local/bin/opencode`) + macOS codesign verification |
| `packages/opencode/script/sign-local.ts` | MEDIUM | dist binary ad-hoc signing on macOS before copy |
| `tool/registry.ts` | **HIGH** | `rename` tool registration in built-in list |
| `tool/rename.ts` | **HIGH** | `rename` tool id/parameters/Session title update behavior |
| `session/system.ts` | MEDIUM | session naming guidance so agent actually calls `rename` |

## Remaining Backup-Only Patches (not ported 1:1)

These commits still differ from current `dev` and should be periodically re-evaluated:

- `33956770e` — long-running quiet command heartbeat in legacy `tool/bash.ts`; current code uses `tool/shell.ts`, so this was not ported directly.
- `7b51f4526` — `bin/opencode.cjs` packaging path migration; current upstream/fork packaging still targets `bin/opencode`.

## Import Path Differences

Upstream uses `@opencode-ai/core/util/encode` and `@opencode-ai/core/util/path`.
If upstream ever renames these, update all sidebar files accordingly.

## API Path Note

The global session API is at `client.experimental.session` (upstream renamed from `client.global.session`).
If this changes upstream, update `sidebar-recent.tsx`.

---

## How to Rebase Safely

```bash
# 1. Create a backup branch BEFORE rebasing
git branch backup/dev-$(date +%Y%m%d%H%M%S)

# 2. Rebase
git rebase upstream/dev

# 3. After resolving conflicts, diff against backup to check for lost features
git diff HEAD..backup/dev-YYYYMMDDHHMMSS -- packages/app/src/pages/layout/

# 4. Walk through features 1–13 above and verify each one in the code
# 5. Run typecheck
cd packages/opencode && bun typecheck

# 6. Build and deploy
cd packages/opencode && bun run build
# Copy binary to ~/.local/bin/opencode on the remote
# Restart service: systemctl --user restart opencode-serve

# 7. Run the Browser Smoke Test checklist above on the deployed instance
```

## Deployment Quick Reference

```bash
# On remote VM (azureuser@100.108.64.76):
export PATH=$HOME/.local/bin:$HOME/.bun/bin:$PATH
cd /home/azureuser/workspace/opencode-deploy-159-OhZXeN
git pull origin dev
cd packages/opencode && bun run build
# Stop service, copy binary, restart:
systemctl --user stop opencode-serve
cp dist/opencode-linux-x64/bin/opencode ~/.local/bin/opencode
systemctl --user start opencode-serve
```

### Service Configuration

```ini
# systemd unit: ~/.config/systemd/user/opencode-serve.service
ExecStart=opencode serve --hostname "100.108.64.76" --port 4096

# Override: ~/.config/systemd/user/opencode-serve.service.d/override-workingdir.conf
WorkingDirectory=/home/azureuser/workspace/opencode-deploy-159-OhZXeN

# Override: ~/.config/systemd/user/opencode-serve.service.d/override.conf
Environment=OPENCODE_INSTANCE_MAX=16
Environment=OPENCODE_INSTANCE_IDLE_MS=1800000
```

### Important Deployment Notes

- **Binary embeds the web UI** — `bun run build` in `packages/opencode` runs `vite build` on `packages/app` and bundles the result into the binary. Just pulling code is NOT enough; you must rebuild AND copy the binary.
- **Service uses `~/.local/bin/opencode`** — the systemd service runs the installed binary, not source code directly.
- **Cannot overwrite running binary** — must stop the service first (`systemctl --user stop`), then copy, then start.
- **Service takes ~60s to stop** — MCP child processes need time to terminate. Be patient.
- **SSH restart may hang** — use `nohup` wrapper if restarting via SSH: `nohup bash -c "systemctl --user restart opencode-serve" &`
- **Verify after deploy** — `curl http://100.108.64.76:4096/` should return 200, then run the Browser Smoke Test.

---

## 🔐 Security Review (2026-05-13)

Deep audit of every outbound HTTP call, the sharing pipeline, LLM request headers, remote config, MCP tools, and bundled web UI. All critical claims verified against source code. Full report: https://github.com/dzianisv/opencode/issues/198

**Verdict: No backdoors. No always-on telemetry. Several conditional data-egress paths documented below.**

### Conditional data leaks (all require explicit opt-in)

| Finding | Risk | Trigger | What leaves the machine |
|---|---|---|---|
| **Session sharing** | MEDIUM | `share: "auto"` or manual share | Full user prompts, assistant responses, tool I/O, code diffs (unified patch, changed lines only) → `opncd.ai` |
| **`opencode` provider** | MEDIUM | Explicit `provider.opencode.options.apiKey` config | All LLM requests route through `opncd.ai`; headers include pseudonymous project ID + session UUID |
| **GitHub token exchange** | MEDIUM | `opencode github` in CI | GitHub PAT/OIDC token POSTed to `api.opencode.ai` to get a GitHub App token |
| **Web search tool** | LOW | LLM tool invocation (permission prompt) | Search query → `exa.ai`; query + session UUID + model name → `parallel.ai` |
| **Enterprise wellknown remote config** | MEDIUM | Wellknown auth entry configured | `remote_config.url` is now constrained to same-origin and rejects embedded URL credentials; cross-origin token/header forwarding is blocked |

### Always-on background calls (no user data)

| Call | Frequency | Data sent |
|---|---|---|
| `models.dev/api.json` — model list refresh | Startup + every 60 min | `User-Agent: opencode/{channel}/{version}/{client}` only |
| npm/brew version check | TUI startup | `User-Agent` only — reveals version/channel. Disable: `autoupdate: false` or `OPENCODE_DISABLE_AUTOUPDATE=1` |

### Not present in the CLI binary (cloud/desktop only)

- **Sentry** — requires `VITE_SENTRY_DSN` at build time; not in distributed binary
- **Honeycomb** — cloud Cloudflare Workers backend (`packages/console`) only
- **PostHog** — manual maintainer script (`script/stats.ts`) only

### Safe paths confirmed

- API keys: only sent as `Authorization` headers to their respective LLM providers, never shared elsewhere
- OpenTelemetry: disabled unless `OTEL_EXPORTER_OTLP_ENDPOINT` env var is set
- Share default: `share: "auto"` is NOT the default; no implicit sharing on session creation

### Recommendations

1. `autoupdate: false` in config to stop version pings on every TUI launch.
2. Use your own provider API keys (Anthropic, OpenAI, etc.) — prompts go directly to the provider with no opencode.ai intermediary.
3. Never set `share: "auto"` unless you want full prompt/response/diff history uploaded to opncd.ai.
4. Enterprise users: keep `.well-known/opencode` and remote config on trusted infrastructure; same-origin and credentialed-URL guards are enforced in code.

### Remediation update (2026-05-14)

- Implemented guardrails in `packages/opencode/src/config/config.ts`:
  - reject `remote_config.url` with embedded `username/password`
  - reject cross-origin `remote_config.url` relative to the wellknown base URL
- Added regression tests in `packages/opencode/test/config/config.test.ts`:
  - `wellknown remote_config rejects cross-origin URL`
  - `wellknown remote_config rejects URL with embedded credentials`

> Audited: `packages/core/src/effect/observability.ts`, `packages/opencode/src/share/`, `packages/opencode/src/snapshot/index.ts`, `packages/opencode/src/installation/index.ts`, `packages/opencode/src/control-plane/workspace.ts`, `packages/opencode/src/cli/upgrade.ts`, `packages/opencode/src/session/llm.ts`, `packages/opencode/src/provider/models.ts`, `packages/opencode/src/tool/`, `packages/opencode/src/config/config.ts`, all install scripts.
