# Schema migration

Practical reference for migrating data types in `packages/opencode` from Zod-first definitions to Effect Schema with Zod compatibility shims.

## Goal

Use Effect Schema as the source of truth for domain models, IDs, inputs, outputs, and typed errors.

Keep Zod available at existing HTTP, tool, and compatibility boundaries by exposing a `.zod` field derived from the Effect schema.

## Preferred shapes

### Data objects

Use `Schema.Class` for structured data.

```ts
export class Info extends Schema.Class<Info>("Foo.Info")({
  id: FooID,
  name: Schema.String,
  enabled: Schema.Boolean,
}) {
  static readonly zod = zod(Info)
}
```

If the class cannot reference itself cleanly during initialization, use the existing two-step pattern:

```ts
const _Info = Schema.Struct({
  id: FooID,
  name: Schema.String,
})

export const Info = Object.assign(_Info, {
  zod: zod(_Info),
})
```

### Errors

Use `Schema.TaggedErrorClass` for domain errors.

```ts
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FooNotFoundError", {
  id: FooID,
}) {}
```

### IDs and branded leaf types

Keep branded/schema-backed IDs as Effect schemas and expose `static readonly zod` for compatibility when callers still expect Zod.

## Compatibility rule

During migration, route validators, tool parameters, and any existing Zod-based boundary should consume the derived `.zod` schema instead of maintaining a second hand-written Zod schema.

The default should be:

- Effect Schema owns the type
- `.zod` exists only as a compatibility surface
- new domain models should not start Zod-first unless there is a concrete boundary-specific need

## When Zod can stay

It is fine to keep a Zod-native schema temporarily when:

- the type is only used at an HTTP or tool boundary
- the validator depends on Zod-only transforms or behavior not yet covered by `zod()`
- the migration would force unrelated churn across a large call graph

When this happens, prefer leaving a short note or TODO rather than silently creating a parallel schema source of truth.

## Ordering

Migrate in this order:

1. Shared leaf models and `schema.ts` files
2. Exported `Info`, `Input`, `Output`, and DTO types
3. Tagged domain errors
4. Service-local internal models
5. Route and tool boundary validators that can switch to `.zod`

This keeps shared types canonical first and makes boundary updates mostly mechanical.

## Checklist

- [ ] Shared `schema.ts` leaf models are Effect Schema-first
- [ ] Exported `Info` / `Input` / `Output` types use `Schema.Class` where appropriate
- [ ] Domain errors use `Schema.TaggedErrorClass`
- [ ] Migrated types expose `.zod` for back compatibility
- [ ] Route and tool validators consume derived `.zod` instead of duplicate Zod definitions
- [ ] New domain models default to Effect Schema first

## Notes

- Use `@/util/effect-zod` for all Schema -> Zod conversion.
- Prefer one canonical schema definition. Avoid maintaining parallel Zod and Effect definitions for the same domain type.
- Keep the migration incremental. Converting the domain model first is more valuable than converting every boundary in the same change.
