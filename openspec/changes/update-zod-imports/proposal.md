## Why

Legacy `zod/v4` and `zod/v4/core` import paths persisted after upgrading to Zod 4.x, creating inconsistency and risk of future breakage. Internal core type import (`JSONSchema`) is unnecessary.

## What Changes

- Replace all `zod/v4` and `zod/v4/core` imports with root `zod`
- Remove dependency on internal `JSONSchema` core type; use plain object typing
- Update event bus to import `ZodType` from root `zod`
- Ensure JSON schema generation uses `z.toJSONSchema`

## Impact

- Affected code: `packages/opencode/src/{bus/index.ts,provider/transform.ts,session/prompt.ts}`, `packages/opencode/script/schema.ts`
- New capability spec introduced: `schema-validation`
- No breaking external API changes; internal consistency improvement
