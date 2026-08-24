# Schema Migration

Use Effect Schema as the source of truth for domain models, DTOs, IDs,
inputs, outputs, and typed errors.

This is guidance, not an inventory. Do not use this file to track which
schema modules are complete; verify current state with `git grep` before
starting a migration.

## Preferred Shapes

Use `Schema.Class` for exported data objects with a clear domain identity:

```ts
export class Info extends Schema.Class<Info>("Foo.Info")({
  id: FooID,
  name: Schema.String,
  enabled: Schema.Boolean,
}) {}
```

Use `Schema.Struct` for local shapes and simple nested objects:

```ts
const Payload = Schema.Struct({
  id: FooID,
  value: Schema.String,
})
```

Use `Schema.TaggedErrorClass` for expected domain errors:

```ts
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FooNotFoundError", {
  id: FooID,
}) {}
```

Use branded schema-backed IDs for single-value domain identifiers.

## Boundary Rule

Effect Schema should own the type. Boundaries should consume Effect Schema
directly or use narrow boundary-specific helpers. Avoid reintroducing a
generic Effect Schema -> Zod bridge.

Current intentional boundaries:

- Public plugin tools still expose Zod through `tool.schema = z`.
- Tool parameters use tool-specific JSON Schema helpers.
- Public config and TUI schema generation goes through the schema script.
- AI SDK object generation uses Standard Schema / JSON Schema helpers.

When Zod must stay temporarily, leave a short note explaining the boundary
or compatibility reason.

## Refinements

Reuse named refinements instead of re-spelling constraints:

```ts
const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
```

Prefer domain-named leaf schemas when the name improves callers or error
messages. Avoid adding brands purely for novelty.

## Migration Order

For a domain that still has mixed schemas:

1. Shared leaf models and branded IDs.
2. Exported `Info`, `Input`, `Output`, and event payload types.
3. Expected domain errors.
4. Service-local internal models.
5. HTTP/tool/AI boundary validators.

Keep public wire shapes stable unless the PR is explicitly a breaking API
change.

## Checklist For A PR

- [ ] There is one schema source of truth for each migrated type.
- [ ] Remaining Zod is an intentional boundary choice.
- [ ] Public JSON/OpenAPI output is unchanged or intentionally updated.
- [ ] Derived helpers are narrow and boundary-specific.
- [ ] Tests assert behavior, not duplicated schema implementation details.
