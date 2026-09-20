# Execution UI Baseline and Contract Evidence

Task: T01 Pin contracts, isolate development, and define scope identity.
Worktree: `/root/git/opencode/.worktrees/execution-ui`
Branch: `execution-ui`
Base: `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11)
Recorded: 2026-09-20

## 1. Environment

| Item | Value |
|---|---|
| Bun | 1.4.2 (`bun --version`), matches root `packageManager: bun@1.4.2` |
| Node package version | `@opencode/app` 2.0.11, `@opencode/client` 2.0.11, `@opencode/protocol` 2.0.11, `@opencode/schema` 2.0.11 |
| Base commit | `c555559ac1b94910b769eebaa595b2b8822efa14` |
| `git status --short` before edits | `?? docs/` only |

### Commands and results

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` (repo root) | PASS: `Checked 2525 installs across 2955 packages (no changes)`; lockfile unchanged |
| `bun run test:unit` (`packages/app`) | PASS: 861 pass, 1 skip, 0 fail, 2657 expect() calls, 128 files, 7.44s |
| `bun run build` (`packages/app`) | PASS: `built in 20.37s`, PWA `precache 911 entries` |
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/identity.test.ts` | See section 6 |

The `test:unit` log contains expected error-path output (`error: disk full`, `read ECONNRESET`) from
negative-path fixtures; the run itself reports 0 failures.

## 2. Supported host

This feature is validated only against OpenCode **2.0.11** (the pinned commit above). App, client,
protocol, and schema are all 2.0.11. Bun 1.4.2 is the only tested runtime. Do not claim other
versions; a later version needs compatibility tests, not a version promise.

## 3. Native session API mapping (characterized)

All calls are generated V2 endpoints in `@opencode/client/promise`
(`packages/client/src/promise/generated/client.ts`; output/input types in
`packages/client/src/promise/generated/types.ts`). No V1 SDK or todo endpoint is used.

| Purpose | Exact call | HTTP | Output shape | Complete or paginated |
|---|---|---|---|---|
| List sessions | `api.session.list({ limit?, order?, search?, parentID?, directory?, project?, subpath?, cursor? })` | `GET /api/session` | `SessionListOutput = { data: SessionInfo[]; cursor: { previous?: string \| null; next?: string \| null } }` | Paginated. Follow `cursor.next`. |
| Get one session | `api.session.get({ sessionID })` | `GET /api/session/{sessionID}` | `SessionInfo` | Complete single record. |
| Running-status snapshot | `api.session.active()` | `GET /api/session/active` | `{ [sessionID]: { type: "running" } }` | Complete snapshot of running sessions only. |
| Move session to background | `api.session.background({ sessionID })` | `POST /api/session/{sessionID}/background` | `void` | Mutation, **not** a list. |
| Message history | `api.message.list({ sessionID, limit?, order?, cursor?, type? })` | `GET /api/session/{sessionID}/message` | `SessionMessagesResponse = { data: SessionMessageInfo[]; cursor: { previous?: string \| null; next?: string \| null } }` | Paginated. |
| Single message | `api.session.message.get({ sessionID, messageID })` | `GET /api/session/{sessionID}/message/{messageID}` | `SessionMessageInfo` | Complete single record. |
| Pending inbox | `api.session.inbox.list({ sessionID })` | `GET /api/session/{sessionID}/inbox` | `SessionInboxInfo[]` | Complete for the session. |
| Question/permission forms | `api.session.form.list({ sessionID })` | `GET /api/session/{sessionID}/form` | `FormInfo[]` | Complete for the session. |
| Event log (SSE) | `api.session.log({ sessionID, after?, follow? })` | `GET /api/experimental/session/{sessionID}/log` | `AsyncIterable` | Streaming, experimental. |
| Context/diff | `api.session.context`, `api.session.diff` | `GET .../context`, `.../diff` | session context/diff | Complete reads. |

There is no `session.history`, `session.children`, `session.status`, `session.messages`, or
`session.todo` method in this checkout. "History" maps to `api.message.list` /
`api.session.message.get`; "children" maps to `api.session.list({ parentID })`; "status" maps to
`api.session.active()` plus the store projection below.

### Store adapter (`@opencode/client/solid`)

`packages/client/src/solid/data.ts` (surfaced as `server.ctx.data` via
`packages/app/src/runtime/server/client.tsx`; wrapped by
`packages/app/src/runtime/server/data.ts`):

| Adapter member | Behavior |
|---|---|
| `data.session.list()` | In-memory `SessionInfo[]` sorted by `time.updated` desc. Not an agent registry. |
| `data.session.get(id)` | Cached `SessionInfo` or `undefined`. |
| `data.session.sync(id, { children?: boolean })` | `api.session.get`; with `children`, one `api.session.list({ parentID: id, order: "desc" })` call, **no cursor follow-up**. |
| `data.session.root(id)` / `family(id)` | Parent-chain root resolution plus a flat family index. |
| `data.session.status(id)` | `store.session.active[id] ?? "idle"` typed `"running" \| "idle"`. |
| `data.session.message.list/get/more/loadMore` | Cached transcript; `loadMore` follows `cursor.next`. |
| `data.session.permission.list/sync` | Pending permission requests per session. |
| `data.session.form.list/sync` | Pending question/permission forms per session. |
| `data.session.evict(id)` | Clears heavy data for root and known descendants. |

### Pagination shape and completeness

- **Session list is paginated.** The app's complete-enumeration helper is
  `listAllSessions` in `packages/app/src/session/list.ts`: default `limit: 100`, recurse on
  `result.cursor.next` until exhausted.
- **Descendant enumeration as currently used is not complete.** `data.session.sync(id, { children: true })`
  fetches only the first `parentID` page and never follows `cursor.next`. Downstream (T02) must page
  every child page to hydrate a full tree.
- **Message history is paginated.** `data.session.message.sync` uses `limit: 20` desc
  (`messagePageLimit`); `loadMore` uses 20 per page, or 200 when `all: true`, following `cursor.next`.
- **Single session/message reads are complete.**

### Unknown status

- The V2 wire only carries a running marker: `SessionActive = { type: "running" }`. Absence means
  not-running; there is no native "unknown" wire value.
- The store collapses absence to `"idle"`. Idle is not completion.
- `NativeRecord.status` (T01 `native-types.ts`) adds an explicit `"unknown"` for a session whose info
  has not been hydrated (for example a descendant ID discovered before its record loads) or whose
  lookup failed. Unknown must stay distinguishable from idle so partial trees are honest.
- Needs-input comes from native permission (`data.session.permission`) and form
  (`data.session.form`) state; descendant requests are walked with `sessionTreeIDs` in
  `packages/app/src/session/requests/session-request-tree.ts`.

### V1 exclusion confirmation

The mapping uses only the generated V2 calls above. No V1 SDK method (`session.messages`,
`session.children`, `session.todo`, `session.status`, `tui.*`) appears in this mapping. Grep of
`packages/client/src`, `packages/protocol/src`, and `packages/schema/src` finds no `todo` endpoint;
the only `TODO` hit is a prose comment in `packages/client/src/effect/index.ts`.

## 4. Scope identity contract

`packages/app/src/superpowers/identity.ts`:

- `createExecutionScope({ serverKey?, ownerDirectory?, rootSessionID? })` — the adapter boundary.
  Rejects an empty, whitespace-only, or missing server key, owner directory, or root session ID by
  returning `undefined`, so an invalid scope is never keyed as if it were valid.
- `scopeKey(scope)` — `JSON.stringify([serverKey, ownerDirectory, rootSessionID])`.
- `runKey(scope, runID)` — `JSON.stringify([serverKey, ownerDirectory, rootSessionID, runID])`.

Identity boundaries: server identity, owner directory, root session, and run ID. Keys are serialized
tuples, never slash-concatenated path fragments, so delimiter-containing directory names cannot
collide and identical session IDs on two authenticated server connections never share a key.

`serverKey` is `ServerConnection.key(conn)` from `packages/app/src/runtime/server/registry.tsx`.
Downstream consumers must call that function instead of reconstructing a key, so identity always
agrees with the selected-server registry. Its exact mapping is:

| `conn.type` | Returned key |
|---|---|
| `http` | `conn.http.url` (the raw URL, branded `ServerConnection.Key`; no `http:` prefix) |
| `sidecar` with `variant: "base"` | `"sidecar"` |
| `sidecar` with `variant: "wsl"` | `wsl:{conn.distro}` |
| `ssh` | `ssh:{conn.id ?? conn.host}` |

`ownerDirectory` is the owning session location directory. `rootSessionID` is the resolved family root.

`packages/app/src/superpowers/native-types.ts` exports the shared `NativeRecord` shape consumed by T02.

## 5. i18n and component-fixture conventions

- English source dictionary: `packages/app/src/runtime/i18n/en.ts`, exports `dict` (spread of
  `DESKTOP_NATIVE_ENGLISH`) plus `export default dict`. Runtime merge is
  `packages/app/src/runtime/i18n/language.tsx`. Feature work adds English keys only.
- Component fixture bootstrapping pattern (from `packages/app/component-tests/browser-pane.*`):
  - Fixture `packages/app/component-tests/<name>.fixture.tsx` exports `mount<Name>()`, creates a host
    element, appends it to `document.body`, and `render(...)` from `solid-js/web` inside the real
    providers (`LanguageProvider locale="en"`, `UiI18nBridge`, `DialogProvider`).
  - Spec `packages/app/component-tests/<name>.spec.ts` imports `{ expect, story }` from
    `../../storybook/playwright/story`, resolves the fixture with
    `/@fs/${fileURLToPath(new URL("./<name>.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`,
    mounts the bootstrap story with `mount(...)` in `story.beforeEach`, then dynamically imports and
    calls `mount<Name>()` inside `page.evaluate`.
  - Config: `packages/app/playwright.components.config.ts` delegates to
    `../storybook/playwright/config`. Run with
    `bun run test:components component-tests/<name>.spec.ts`.

## 6. T01 test evidence

RED before implementation:

```text
$ cd packages/app && bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/identity.test.ts
error: Cannot find module './identity' from '.../src/superpowers/identity.test.ts'
 0 pass
 1 fail
 1 error
```

GREEN after implementation:

```text
(pass) server and owner location are identity boundaries
(pass) delimiter-containing directory names cannot collide
(pass) the adapter boundary rejects empty or missing scope identity
(pass) identical root IDs on two authenticated servers never share a key
(pass) native records expose an explicit unknown status
 5 pass / 0 fail / 16 expect() calls
```

`bun run typecheck` (`packages/app`, `tsgo -b`) passes.

## 7. Benchmarks

The benchmark harness starts only a disposable in-process mock server
(`packages/app/e2e/utils/mock-server.ts`) and a production build served on a local port; it never
contacts the user's OpenCode service.

`bench:tabs` and `bench:entry` **could not produce paired baseline numbers** in this environment.
Both fail at Playwright Chromium launch, before any metric is recorded, because the host is missing
the Playwright browser system libraries (`libnspr4.so`, `libnss3`). The production build and preview
server start correctly; the failure is environmental, not a product regression. Exact commands and
errors are in section 8.

Both benchmark specs build and serve a local production app and drive a disposable in-process mock
server, so they are safe to run; the blocker is only the missing OS libraries for the headless
browser.

## 8. Unrun gates

All rows below are **UNRUN**, not passes. No threshold was changed and no result was fabricated.

| Gate | Exact command | Outcome |
|---|---|---|
| `bench:tabs` | `cd packages/app && bun run bench:tabs` | EXIT 1. Build served; 100 tests ran; every test failed at browser launch: `browserType.launch: Target page, context or browser has been closed` → `chrome-headless-shell: error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory`. Log: `/tmp/opencode/bench-tabs.log`. |
| `bench:entry` | `cd packages/app && bun run bench:entry` | EXIT 1, same missing `libnspr4.so` launch failure (120 occurrences). Log: `/tmp/opencode/bench-entry.log`. |
| Playwright component tests | `cd packages/app && bun run test:components ...` | UNRUN for the same missing-browser-library reason. |
| Playwright e2e tests | `cd packages/app && bun run test:e2e` | UNRUN for the same missing-browser-library reason. |
| Windows Desktop smoke | (Windows host required) | UNRUN; no Windows host in this environment. |
| Live-server checks | `bun run dev:live` etc. | Deliberately not run against the user's service; only disposable fixtures/mock servers are permitted. |

Host: Ubuntu 24.04.2 LTS; `ldconfig -p` reports no `libnspr4`/`libnss3`.
