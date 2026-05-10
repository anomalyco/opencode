# OpenAPI Translation Cleanup Plan

## Goal

Trim `packages/opencode/src/server/routes/instance/httpapi/public.ts` until OpenAPI generation is mostly a direct projection of the `HttpApi` route declarations, without breaking the generated SDK surface.

The main failure mode to eliminate is spec-only behavior: anything that appears in `/doc` or the SDK but is not accepted by runtime `HttpApi` validation.

## Current Culprit

`public.ts` exports `PublicApi` with a large `OpenApi.annotations({ transform })` hook. That hook rewrites the generated spec for legacy SDK compatibility.

The highest-risk rewrite is `InstanceQueryParameters`, which injected `directory` and `workspace` into every instance route in OpenAPI even when the runtime query schema did not accept them. This caused the SDK and `/doc` to advertise calls that could fail with `400` at runtime.

## Non-Negotiables

- Do not break the generated JavaScript SDK without an explicit versioned migration plan.
- Runtime route schemas are the source of truth for accepted params, payloads, and responses.
- `/doc`, generated SDK types, and runtime validation must agree for every endpoint.
- Prefer endpoint or schema annotations over post-generation spec surgery.
- Remove one category of rewrite at a time, with focused compatibility checks.

## PR Checklist

Status legend: `[x]` done locally, `[~]` in progress locally, `[ ]` not started.

Current combined PR scope:

- `[x]` PR 1 drift tests: added OpenAPI/runtime query assertions and a negative fixture in `test/server/httpapi-query-schema-drift.test.ts`.
- `[x]` PR 2 injection removal: removed broad `directory` / `workspace` post-generation injection from `public.ts` and replaced it with explicit runtime query schemas on affected routes.
- `[ ]` PR 3+ cleanup: leave query override, path pattern, error shape, auth, and component-shape rewrites for later PRs.

### PR 1: Add OpenAPI/Runtime Query Drift Tests

- `[x]` Add or extend `packages/opencode/test/server/httpapi-query-schema-drift.test.ts`.
- `[x]` Import `OpenApi.fromApi` and `PublicApi`.
- `[x]` Generate the public spec in-process with `OpenApi.fromApi(PublicApi)`.
- `[x]` Add a route inventory for the existing runtime reproducers: `session`, `file`, `experimental`, and `instance` routes.
- `[x]` For each inventory entry, assert every OpenAPI query parameter is declared by the runtime query schema.
- `[x]` Add a negative regression fixture that fails on spec-only `directory` / `workspace` params.
- `[x]` Keep this part test-only.

Verification:

- `[x]` `bun test --timeout 5000 test/server/httpapi-query-schema-drift.test.ts` from `packages/opencode`.
- `[x]` `bun typecheck` from `packages/opencode`.

### PR 2: Delete Spec-Only Workspace Query Injection

- `[x]` Edit `packages/opencode/src/server/routes/instance/httpapi/public.ts`.
- `[x]` Delete `InstanceQueryParameters`.
- `[x]` Delete the `isInstanceRoute` constant.
- `[x]` Delete the branch that prepends `directory` and `workspace` to every instance operation.
- `[x]` Keep `normalizeParameter(param, route)` for parameters that are actually produced by `HttpApi`.
- `[x]` Add `WorkspaceRoutingQuery` / `WorkspaceRoutingQueryFields` to runtime query schemas for affected routes.
- `[x]` Regenerate SDK and inspect diff. Result: no `directory` / `workspace` request-param removals; generated SDK diff is declaration ordering only.

Notes:

- Added `WorkspaceRoutingQuery` in `middleware/workspace-routing.ts` as the canonical runtime schema for middleware-consumed query params.
- Replaced v2 union-query schemas with plain struct query schemas so `OpenApi.fromApi` emits their query params directly. This intentionally exposes the beta `/api/session` pagination/filter params in the SDK; cursor mutual-exclusion rules now live in the handlers, while `directory` / `workspace` remain allowed with cursors for routing.

Expected code shape:

```ts
for (const param of operation.parameters ?? []) normalizeParameter(param, `${method.toUpperCase()} ${path}`)
```

Verification:

- `[x]` `bun test --timeout 5000 test/server/httpapi-query-schema-drift.test.ts` from `packages/opencode`.
- `[x]` `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `[x]` `./packages/sdk/js/script/build.ts` from repo root.
- `[x]` Inspect SDK diff for removed `directory` / `workspace` params. Result: none after explicit runtime schemas; v2 list/message now also expose their existing beta pagination/filter query params in the SDK.
- `[x]` `bun typecheck` from `packages/opencode`.

### PR 3: Replace Broad Query Type Override Sets With Route-Level Helpers

- Edit `packages/opencode/src/server/routes/instance/httpapi/public.ts`.
- Remove broad name-based assumptions from `QueryNumberParameters` and `QueryBooleanParameters` one field at a time.
- Add shared query schema helpers near route group code if needed, for example in `groups/metadata.ts` or a new `groups/query.ts`.
- Prefer route declarations like `Schema.NumberFromString.check(...)` and boolean string decoders like the existing `QueryBoolean` in `groups/session.ts`.
- Keep only route-specific `QueryParameterSchemas` entries when SDK compatibility requires a public encoded type that Effect OpenAPI cannot emit yet.

Concrete first targets:

- `[x]` Consolidate `roots` / `archived` onto an explicit shared route schema helper. Keep `QueryBooleanParameters` until route-level schema metadata can preserve the SDK's `boolean | "true" | "false"` call shape without a global transform.
- `[x]` Replace broad `QueryNumberParameters` reliance for `start` / `cursor` / `limit` with route-specific SDK compatibility schemas. Keep improving route-level constraints where behavior is intentionally stricter.
- Keep `GET /find/file limit`, `GET /session/{sessionID}/diff messageID`, and `GET /session/{sessionID}/message limit` overrides until their route schemas generate identical SDK types directly.

Verification:

- Focused HTTP tests for changed query fields.
- `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect generated SDK request param types before deleting each override.
- `bun typecheck` from `packages/opencode`.

### PR 4: Move Path Parameter Patterns Into ID Schemas

- Audit `PathParameterSchemas` and `pathParameterSchema()` in `public.ts`.
- Check source schemas in files like `packages/opencode/src/session/schema.ts`, `packages/opencode/src/permission/schema.ts`, and pty schema definitions.
- Add or fix `ZodOverride` / OpenAPI-compatible annotations on branded ID schemas so generated path params include the same patterns without `public.ts` overrides.
- Delete one path override only after generated OpenAPI is unchanged for that param.

Concrete first targets:

- `[x]` `sessionID`
- `[x]` `messageID`
- `[x]` `partID`
- `[x]` `permissionID`
- `[x]` `ptyID`

Leave ambiguous route-local `id` overrides for workspace routes until they are renamed or explicitly typed in endpoint params.

Verification:

- `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect generated path param types and patterns.
- `bun typecheck` from `packages/opencode`.

### PR 5: Replace Built-In Error Rewrites With Declared API Errors

- Edit route group files under `packages/opencode/src/server/routes/instance/httpapi/groups/`.
- Replace SDK-visible `HttpApiError.BadRequest` / `HttpApiError.NotFound` with explicit error schemas from `packages/opencode/src/server/routes/instance/httpapi/errors.ts` or add new ones there.
- Update handlers to fail with the declared API errors at the boundary.
- Remove matching cases from `normalizeLegacyErrorResponses()` only after generated OpenAPI remains SDK-compatible.
- Do this group by group, starting with one small route group.

Concrete first targets:

- `groups/config.ts` `PATCH /config` bad request.
- `groups/session.ts` endpoints that already translate domain not-found errors.
- `groups/file.ts` if any handler currently relies on built-in error shape.

Verification:

- Focused HTTP tests asserting response body shape for changed error paths.
- `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect SDK error union diff.
- `bun typecheck` from `packages/opencode`.

### PR 6: Remove Auth/Security Spec Rewrites If SDK Can Tolerate It

- Audit `delete operation.security`, `delete operation.responses?.["401"]`, and `delete spec.components?.securitySchemes` in `public.ts`.
- Decide whether SDK should expose auth in generated operation metadata.
- If preserving no-auth SDK surface is required, leave this rewrite and document it as intentional compatibility code.
- If removing it, update SDK generation expectations and docs in the same PR.

Verification:

- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect generated client call signatures and error unions.
- Do not merge if auth churn changes normal SDK call ergonomics unintentionally.

### PR 7: Tackle Component Shape Rewrites One At A Time

- Audit these in `public.ts`: `normalizeComponentNames`, `collapseDuplicateComponents`, `applyLegacySchemaOverrides`, `normalizeComponentDescriptions`, `stripOptionalNull`, `fixSelfReferencingComponents`.
- For each rewrite, make a tiny PR that removes or narrows only that rewrite.
- If generated SDK type names churn broadly, stop and either keep the rewrite or fix `effect-smol` generation first.

Concrete first targets:

- Delete cosmetic `normalizeComponentDescriptions` if SDK output does not change materially.
- Narrow `applyLegacySchemaOverrides` entries that correspond to schemas already fixed at the source.
- Keep `stripOptionalNull` until there is an explicit SDK migration plan, because it likely affects many optional fields.

Verification:

- `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect generated SDK type-name and optionality diffs.

## Upstream Middleware Query Support

Long-term, `WorkspaceRoutingMiddleware` should declare the query fields it reads once, and `HttpApi` should use that declaration for both runtime validation and OpenAPI generation.

Target in `effect-smol`:

- Extend `HttpApiMiddleware.Service` config with optional query schema support, or add a dedicated middleware query annotation.
- Make runtime request decoding include middleware query schemas.
- Make `OpenApi.fromApi` emit middleware query params for endpoints using that middleware.

Once available, remove `WorkspaceRoutingQueryFields` spreads from route groups and declare `directory` / `workspace` only on `WorkspaceRoutingMiddleware`.

## Suggested PR Order

1. Add drift detection tests only.
2. Remove `InstanceQueryParameters` spec injection; rely on `WorkspaceRoutingQueryFields` already present in runtime schemas.
3. Convert query type overrides into route/schema-level helpers where possible.
4. Convert path parameter overrides into schema annotations or upstream fixes.
5. Replace built-in error response rewrites with explicit declared API errors by route group.
6. Tackle component naming/nullability rewrites only after SDK compatibility snapshots are stable.

## Verification Checklist Per PR

- Focused HTTP tests for changed routes.
- OpenAPI drift tests.
- `bun dev generate > /tmp/opencode-openapi.json` from `packages/opencode`.
- `./packages/sdk/js/script/build.ts` from repo root.
- Inspect generated SDK diff for public API churn.
- `bun typecheck` from `packages/opencode`.
