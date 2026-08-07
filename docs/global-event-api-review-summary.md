# `/global/event` API Documentation Review Summary

**PR**: https://github.com/anomalyco/opencode/pull/41157  
**Branch**: `houxiyao:doc-event-api` → `dev`  
**Date**: 2026-08-08  
**Reviewer**: artistry (adversarial, consumer-perspective)

---

## Process

1. **Round 1 — Adversarial Review**: Read `docs/global-event-api.md` (472 lines) and companion `docs/api-event-sse.md` (1250 lines). Identified 38 issues from a developer consumer's perspective across 5 categories: developer experience, example quality, Chinese language quality, table readability, and missing practical info.

2. **Round 2 — Source Code Verification**: Verified all 38 issues against actual source code:
   - `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` (global event handler)
   - `packages/opencode/src/bus/global.ts` (GlobalBus emitter)
   - `packages/opencode/src/event-v2-bridge.ts` (EventV2 → GlobalBus bridge)
   - `packages/server/src/handlers/event.ts` (/api/event handler)
   - `packages/core/src/event.ts` (EventV2 core, allBounded queue)
   - `packages/opencode/src/id/id.ts` (event ID generation)
   - `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` (auth)
   - `packages/opencode/src/server/routes/instance/httpapi/api.ts` (API composition)

   Result: 35/38 confirmed, 0 retracted, 1 new issue discovered (#39: SSE `id` field never set), 2 issues upgraded in severity.

3. **Round 3 — Applied Fixes**: 3 minimal fixes + 5 larger additions + 3 optional improvements, all applied directly to the document.

---

## Issues Found (39 total)

### CRITICAL (7)

| # | Issue | Status |
|---|---|---|
| 1 | Two competing endpoints (`/global/event` vs `/api/event`) with incompatible schemas, no cross-referencing | ✅ Fixed — §1.5 endpoint selection guide added |
| 2 | No authentication documentation | ✅ Fixed — §2.5 connection management section added |
| 3 | Placeholder values (`evt_*`) in examples presented as real data | ✅ Fixed — realistic IDs used throughout |
| 4 | No reconnection strategy despite SSE being inherently fragile | ✅ Fixed — Note 7 expanded with full guidance |
| 5 | Heartbeat interval contradiction (10s vs 15s) between documents | ✅ Fixed — §1.5 table clarifies the difference; Note 7 explains mechanism difference |
| 6 | No event ordering guarantees documented | ⚠️ Partially addressed — Note 8 now explains ID format; full ordering semantics remain a deeper design question |
| 39 | SSE `id` field never set, `Last-Event-ID` unsupported | ✅ Fixed — Note 9 explicitly documents this |

### HIGH (11)

| # | Issue | Status |
|---|---|---|
| 7 | No base URL, port, or deployment context | ⚠️ Not fixed (depends on deployment context) |
| 8 | No error response documentation | ✅ Fixed — §2.5 error responses table |
| 9 | No backpressure documentation | ✅ Fixed — Note 10 + §1.5 table |
| 10 | Sync wrapper example uses placeholder data | ✅ Fixed — realistic JSON |
| 11 | No complete wire-format example | ✅ Fixed — §7.5 wire-format example |
| 12 | No filtering/subscription mechanism documented | ⚠️ Not fixed (feature doesn't exist; documenting absence would be low value) |
| 13 | `directory` field semantics buried in footnotes | ⚠️ Partially addressed — §1.5 table mentions it; Note 4 retained |
| 14 | No connection limit documentation | ✅ Fixed — §2.5 connection limits |
| 15 | V1/V2 event coexistence without migration guidance | ⚠️ Not fixed (requires product decision on deprecation timeline) |
| 16 | `session.idle` deprecation lacks timeline | ⚠️ Not fixed (requires product decision) |
| 17 | No SDK or client library references | ⚠️ Not fixed (could be added later) |

### MEDIUM (13)

| # | Issue | Status |
|---|---|---|
| 18 | "线路格式" unnatural Chinese | ✅ Fixed → "传输格式" |
| 19 | "聚合根 ID" assumes DDD knowledge | ✅ Fixed → "关联实体 ID" |
| 20 | "完整事件目录" title ambiguous | ⚠️ Not changed (low impact) |
| 21 | Tables too dense for complex types | ⚠️ Not changed (would require major restructure) |
| 22 | Inconsistent table columns | ✅ Fixed — all 31 tables now have "说明" column |
| 23 | No realistic flow examples | ✅ Fixed — §7.5 typical event flows |
| 24 | `evt_*` format unexplained | ✅ Fixed — ID format documented in §5.2 and Note 8 |
| 25-30 | Various (CORS, SessionStatus formatting, versioning, sync versioning, Last-Event-ID, instance.disposed) | Mixed — #29 fixed (Note 9), others deferred |

### LOW (8)

| # | Issue | Status |
|---|---|---|
| 31-38 | Various (terminology, Accept-Encoding, workspace field, global.disposed handling, TUI events, legacy section, changelog, installation events) | Deferred — low impact |

---

## Changes Applied

### New Sections Added

| Section | Lines | Purpose |
|---|---|---|
| §1.5 端点选择指南 | 9-21 | Endpoint comparison table |
| §2.5 连接管理 | 43-68 | Auth, connection limits, error responses |
| §7.5 完整示例 | 500-545 | Wire-format SSE stream + event flow diagrams |

### Existing Sections Modified

| Section | Change |
|---|---|
| §3 | "线路格式" → "传输格式" |
| §4 | "聚合根 ID" → "关联实体 ID（用于事件分组和重放）" |
| §5.1 | Placeholder `evt_*` → realistic ID + `directory: "global"` |
| §5.2 | Placeholder `evt_*` → realistic ID + ID format explanation |
| §7 | Sync wrapper `"data": { "..." }` → realistic JSON (2 occurrences) |
| §6.1-6.22 | All 31 tables gained a "说明" (description) column |
| §8 Note 7 | Expanded from 1 sentence to full reconnection strategy |
| §8 Note 8 | Expanded with precise ID format specification |
| §8 Note 9 | New — Last-Event-ID not supported |
| §8 Note 10 | New — Backpressure behavior differences |

### Document Statistics

| Metric | Before | After |
|---|---|---|
| Total lines | 472 | 571 |
| Lines added | — | +99 |
| Tables with descriptions | 1/31 | 31/31 |
| Placeholder values | 4 | 0 |
| New sections | — | 3 |

---

## Source Code Evidence

Key findings verified against source code:

1. **Two endpoints confirmed**: `/global/event` uses `GlobalBus` (EventEmitter, unbounded) with envelope `{directory, project?, workspace?, payload}`. `/api/event` uses `EventV2.allBounded(256)` (dropping queue) with Protocol envelope `{id, type, data, durable?, location?}`.

2. **Heartbeat difference confirmed**: `/global/event` sends `server.heartbeat` as a typed event via `Stream.tick("10 seconds")`. `/api/event` sends `: heartbeat\n\n` as an SSE comment via `Stream.tick("15 seconds")`.

3. **Backpressure difference confirmed**: `/global/event` uses `Queue.offerUnsafe()` (unbounded). `/api/event` uses `Queue.dropping(256)` which fails with `SubscriberOverflowError` when full.

4. **Auth confirmed**: `Authorization` middleware on `RootHttpApi` is conditional — `if (!ServerAuth.required(config)) return (effect) => effect`. Supports Basic Auth and `auth_token` query param.

5. **SSE `id` field confirmed**: Both handlers set `id: undefined` in the SSE Event object. `Last-Event-ID` is never read server-side.

6. **Event ID format confirmed**: `evt_` + 12 hex chars (`Date.now() * 0x1000 + counter`, big-endian) + 14 random base62 chars. Total 30 chars. Monotonically ascending.

---

## Remaining Work (Deferred)

These issues require product decisions or larger restructuring:

- **Base URL/port documentation** — depends on deployment context
- **V1/V2 migration timeline** — requires product decision
- **`session.idle` removal timeline** — requires product decision
- **SDK references** — could be added when SDK stabilizes
- **CORS documentation** — needs verification of middleware configuration
- **Table restructuring** — complex property types still cramped in table cells
