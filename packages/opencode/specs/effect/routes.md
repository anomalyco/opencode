# HTTP Route Patterns

Current guidance for `packages/opencode/src/server/routes/instance/httpapi`.

## Handler Shape

Use `HttpApiBuilder.group(...)` for normal JSON and streaming HTTP API
endpoints. Yield stable services once while building the handler layer,
then close over those services in endpoint implementations.

```ts
export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle("list", () => session.list())
  }),
)
```

Use raw `HttpRouter` only for routes that do not fit the request/response
HttpApi model, such as WebSocket upgrades or catch-all fallback routes.

Do not rebuild stable layers inside request handlers. Provide stable
services at the route/layer boundary and use request-level provisioning
only for request-derived context.

## Error Boundaries

Expected service errors should be mapped at the handler boundary to
endpoint-declared public HTTP errors. Keep one-off mappings inline. Extract
small helpers when the same mapping repeats.

Generic middleware should not become a domain-error mapper. It should
handle cross-cutting concerns and final unknown-defect fallback.

Public JSON errors should be explicit schema contracts declared on each
endpoint or group. Built-in `HttpApiError.*` is fine only when its generated
body is intentionally the public wire shape.

Preserve existing `{ name, data }` error bodies until a deliberate breaking
API change.

## OpenAPI Compatibility

`public.ts` still owns SDK/OpenAPI compatibility transforms. Shrink those
transforms by tightening source schemas one workaround at a time.

When an OpenAPI-visible source schema changes:

- verify the generated SDK diff is intentional
- preserve legacy compatibility unless the PR explicitly changes it
- prefer source-schema fixes over new post-processing rules

## Checklist For Route PRs

- [ ] Stable services are yielded at handler-layer construction.
- [ ] Expected domain errors are translated at the route boundary.
- [ ] Endpoint/group error schemas describe the public body and status.
- [ ] Middleware does not gain new domain-specific name checks.
- [ ] Raw routes are used only when HttpApi is the wrong abstraction.
