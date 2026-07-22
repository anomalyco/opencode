# Tasks: token-management — Fase 1 (Foundation)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~700–800 (16 files: 4 new, 12 modified) |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Delivery strategy | `ask-on-risk` (default) |
| Chain strategy | `pending` |
| Decision needed before apply | **Yes** |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| WU1 | Schema + JWT helper | PR 1 → `dev` | T1, T2, T3. Compiles, no runtime change. |
| WU2 | Login + Identity service | PR 2 → `dev` | T4, T5, T6. Login persists identity row. |
| WU3 | Sidecar endpoints + Budget stub | PR 3 → `dev` | T7, T8, T9, T10. `/me` + `/admin/*` callable. |
| WU4 | IPC + UI | PR 4 → `dev` | T11, T12, T13. Header renders email. |
| WU5 | Tests | PR 5 → `dev` (or merge into WU2–WU4) | T14, T15, T16. Unit + integration. |

Single-PR fallback (`size:exception`) is **not** recommended; tasks are independently shippable.

---

## Phase 1 — Schema & Auth Foundation (WU1)

- [ ] **T1** — Widen `Auth.Oauth` schema with optional identity fields. *Read `packages/opencode/src/auth/index.ts`; add `email`, `displayName`, `tenantId` as `Schema.optional(Schema.String)`. Update `Oauth` doc comment with JWT claim sources. Verify legacy `auth.json` still parses.* **Files:** `packages/opencode/src/auth/index.ts`. **Deps:** none. **Complexity:** S.

- [ ] **T2** — Append 3 Drizzle tables to account SQL schema. *Read `packages/core/src/account/sql.ts`; append `UserIdentityTable`, `TokenBalanceTable` (1:1 FK cascade), `TokenTransactionTable` (append-only, `idx_tx_user`). Use snake_case field names per repo convention. Ensure `IF NOT EXISTS` on first boot.* **Files:** `packages/core/src/account/sql.ts`. **Deps:** none. **Complexity:** S.

- [ ] **T3** — Add shared `parseJwtClaims` + `extractIdentity` helper. *Read `packages/opencode/src/plugin/microsoft.ts`; create `packages/opencode/src/auth/jwt.ts` exporting `parseJwtClaims(idToken)` (no signature verify) and `extractIdentity(claims)` returning `{ email?, displayName?, tenantId? }`. Use Schema-driven parsing.* **Files:** `packages/opencode/src/auth/jwt.ts` (new), `packages/opencode/src/auth/index.ts` (re-export). **Deps:** T1. **Complexity:** S.

## Phase 2 — Login & Identity Persistence (WU2)

- [x] **T4** — Update `plugin/microsoft.ts` to return identity fields. *Read `packages/opencode/src/plugin/microsoft.ts` (callback + refresh path); call `extractIdentity` on `id_token`; include `email`/`displayName`/`tenantId` in `AuthCallbackResult`. Keep non-desktop path working (no DB).* **Files:** `packages/opencode/src/plugin/microsoft.ts`. **Deps:** T1, T3. **Complexity:** M.

- [x] **T5** — Update `login-gate.ts` to decode id_token and send identity. *Read `packages/desktop/src/main/login-gate.ts`; decode `id_token` after token exchange; include identity fields in `PUT /auth/microsoft` body. Malformed JWT → log + continue with `accountId` only.* **Files:** `packages/desktop/src/main/login-gate.ts`. **Deps:** T1, T3. **Complexity:** M.

- [x] **T6** — Create `Identity.Service`. *New `packages/opencode/src/identity/index.ts`. Methods: `upsertFromAuth` (BEGIN IMMEDIATE; first-user-admin via `SELECT EXISTS` inside same tx; `INSERT OR REPLACE user_identity`; `INSERT OR IGNORE token_balance`), `getByID`, `getCurrent` (reads `Auth.Service.get("microsoft") → accountId`), `requireAdmin`, `listUsersWithBalances`, `credit` (Fase 2+ logic, Fase 1 stub allowed). `export * as Identity from "."`. Gated by `process.env.OPENCODE_TOKEN_MGMT`.* **Files:** `packages/opencode/src/identity/index.ts` (new). **Deps:** T2, T1, T5. **Complexity:** L.

## Phase 3 — Sidecar Endpoints & Budget Seam (WU3)

- [ ] **T7** — Define `Budget.Service` interface + no-op defaultLayer. *New `packages/opencode/src/provider/budget.ts`. Export `BudgetExhaustedError` (Schema.TaggedErrorClass) and `Interface` (resolveModel, check, deduct, credit). `defaultLayer` returns no-op impls so `llm.ts` keeps compiling. `export * as Budget from "."`.* **Files:** `packages/opencode/src/provider/budget.ts` (new). **Deps:** none (stub). **Complexity:** S.

- [ ] **T8** — `GET /me` route group + handler. *New `groups/identity.ts` + `handlers/identity.ts` (follow existing groups/handlers pattern under sidecar). Response: `{ id, email, displayName, tenantId, isAdmin, balance }`. Auth via existing Basic middleware. 401 when no session.* **Files:** sidecar `groups/identity.ts` (new), `handlers/identity.ts` (new). **Deps:** T6, T1. **Complexity:** M.

- [ ] **T9** — Admin endpoints with gate. *New `groups/admin.ts` + `handlers/admin.ts`. `GET /admin/users` returns `{ users: [...] }`; `POST /admin/users/:id/credit` body `{ amount, description }`, returns `{ userId, newBalance, transactionId }`. Gate via `Identity.requireAdmin` (401). 404 missing user; 400 negative amount. Both inside one `BEGIN IMMEDIATE` transaction (tx + balance update).* **Files:** sidecar `groups/admin.ts` (new), `handlers/admin.ts` (new). **Deps:** T6. **Complexity:** L.

- [ ] **T10** — Mount `IdentityApi` and `AdminApi` in sidecar `api.ts`. *Read sidecar `api.ts`; add `IdentityApi` and `AdminApi` route registrations alongside existing groups.* **Files:** sidecar `api.ts`. **Deps:** T8, T9. **Complexity:** S.

## Phase 4 — IPC Bridge & Renderer UI (WU4)

- [ ] **T11** — Add IPC handlers in desktop main. *Read `packages/desktop/src/main/ipc.ts`; add `ipcMain.handle("user.get")`, `"user.listAdmin"`, `"user.credit"`. Each calls sidecar `fetch` with `Basic opencode:<pwd>` (matches `kill-sidecar` pattern). Pass `amount`/`description` through for credit.* **Files:** `packages/desktop/src/main/ipc.ts`. **Deps:** T8, T9. **Complexity:** M.

- [ ] **T12** — Expose `user` API on `window.api` via preload. *Read `packages/desktop/src/preload/index.ts` + `types.ts`; add `user: { get, listAdmin, credit }` to the `Api` interface and `contextBridge.exposeInMainWorld` mapping.* **Files:** `packages/desktop/src/preload/index.ts`, `packages/desktop/src/preload/types.ts`. **Deps:** T11. **Complexity:** S.

- [ ] **T13** — Render "Signed in as {email}" in `titlebar.tsx`. *Read `packages/app/src/components/titlebar.tsx`; add `createResource` calling `window.api.user.get()` at boot; render `Signed in as ${email}` when present; hide line on null. No re-render churn.* **Files:** `packages/app/src/components/titlebar.tsx`. **Deps:** T12. **Complexity:** S.

## Phase 5 — Testing (WU5, parallelizable into WU2–WU4)

- [ ] **T14** — Unit tests for JWT helpers. *Fixtures: all-claims, missing optional, malformed. Assert `parseJwtClaims` doesn't throw; `extractIdentity` returns `undefined` for missing. Run from `packages/opencode` with `bun test`.* **Files:** `packages/opencode/src/auth/jwt.test.ts` (new). **Deps:** T3. **Complexity:** S.

- [ ] **T15** — Unit tests for `Identity.upsertFromAuth`. *In-memory SQLite. (a) Empty table → `is_admin = 1` exactly once; (b) second user → `is_admin = 0`; (c) legacy `auth.json` without identity fields round-trips; (d) malformed JWT does not throw.* **Files:** `packages/opencode/src/identity/identity.test.ts` (new). **Deps:** T6. **Complexity:** M.

- [ ] **T16** — Integration tests for `/me` and `/admin/*`. *Seed two users (one admin) in sidecar test harness. (a) `GET /me` with valid Basic → 200; (b) `GET /admin/users` non-admin → 401; (c) `POST /admin/users/:id/credit` with negative amount → 400; (d) credit to missing user → 404.* **Files:** sidecar test directory (new file). **Deps:** T8, T9. **Complexity:** M.

---

## Implementation Order

T1 → T2 → T3 → (T4 ∥ T5) → T6 → T7 (parallel with T6) → T8 → T9 → T10 → T11 → T12 → T13. Tests (T14, T15, T16) ship alongside their respective work units.

## Rollout Note

`process.env.OPENCODE_TOKEN_MGMT` gates `Identity.Service` layer entirely. Unset = no rows, no `/me`. F2 ships behind the same flag.
