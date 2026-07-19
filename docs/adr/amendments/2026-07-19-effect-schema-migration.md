# Amendment 2026-07-19 — Effect Schema Migration (Stage 3)

## Context

`packages/opencode/AGENTS.md` (L91-96) requires:

> "Use `Schema.Class` for multi-field data"
> "Use branded schemas (`Schema.brand`) for single-value types"

Prior to this amendment, two Todo Sidebar Feature files used `zod`
instead of Effect Schema:

- `packages/opencode/src/issue/issue.ts` — `Status`, `Outcome`,
  `Priority`, `Info`, `IssueNode` schemas were defined with
  `z.string()`, `z.enum(...)`, `z.object({...})`, `z.number().int().min(0)`,
  `z.record(z.string(), z.unknown())`, `.describe(...)`, `.meta({ref})`,
  and `z.infer<typeof X>`.
- `packages/opencode/src/issue/linear-binding.ts` — `Binding` and
  `FileSchema` used `z.object({...})`, and disk parsing used
  `FileSchema.safeParse(json)` + `parsed.success` checks.

The main codebase has 0 zod usages outside of `registry.ts` (which is
the documented plugin-compatibility boundary — see its inline comment:
"Plugin tools still expose Zod args publicly; keep that compatibility
boxed at the registry boundary"). 20+ files in `packages/opencode/src`
already use `Schema.Struct` / `Schema.String` / `Schema.Literals`
(e.g., `src/session/session.ts`, `src/account/schema.ts`,
`src/session/message.ts`). The feature-scope files were the only
holdouts.

## Decision

Migrate both files to Effect Schema. Keep `registry.ts` unchanged
(it is the main-branch plugin compatibility boundary and explicitly
out of Todo Sidebar Feature scope per workspace rule).

## Stage 3.1 — `packages/opencode/src/issue/issue.ts`

### Schema replacements

| Before (zod) | After (Effect Schema) |
| --- | --- |
| `import z from "zod"` | `import { NonNegativeInt } from "@opencode-ai/core/schema"` |
| `z.string().describe("...")` | `Schema.String.annotate({ description: "..." })` |
| `z.enum(["done", "canceled", "duplicate"])` | `Schema.Literals(["done", "canceled", "duplicate"])` |
| `z.enum([...]).describe("...")` | `Schema.Literals([...]).annotate({ description: "..." })` |
| `z.object({...}).meta({ ref: "Issue" })` | `Schema.Struct({...}).annotate({ identifier: "Issue" })` |
| `Info.extend({...})` (zod extend) | `Schema.Struct({ ...Info.fields, children: Schema.Array(Info) }).annotate({ identifier: "IssueNode" })` |
| `z.infer<typeof X>` | `Schema.Schema.Type<typeof X>` |
| `.default("")` | (removed — defaults handled in `toRow`/`mapRow`) |
| `.nullable().optional()` | `Schema.optional(Schema.NullOr(...))` |
| `z.number().int().min(0)` | `NonNegativeInt` (from `@opencode-ai/core/schema`) |
| `z.record(z.string(), z.unknown())` | `Schema.Record(Schema.String, Schema.Unknown)` |

### Type-inference side effect

`Schema.Schema.Type<typeof T>` infers fields as `readonly`. Code that
previously built a `Partial<Issue.Info>` via mutation
(`patch.title = params.title`) failed typecheck. The fix is to build
the patch via object literal spread:

```typescript
const patch: Partial<Issue.Info> = {
  ...(params.title !== undefined ? { title: params.title } : {}),
  ...(params.content !== undefined ? { content: params.content } : {}),
  // ...
}
```

This is captured as a Lessons Learned entry in `project_memory.md`.

### API correction

- `.annotations({...})` does not exist on Effect Schema; the correct
  API is `.annotate({...})` (singular). Caught by typecheck during the
  first pass; corrected globally.

## Stage 3.2 — `packages/opencode/src/issue/linear-binding.ts`

### Schema replacements

| Before (zod) | After (Effect Schema) |
| --- | --- |
| `import z from "zod"` | `import { ..., Option } from "effect"` (Option already used elsewhere) |
| `z.object({...})` for `Binding` | `Schema.Struct({...}).annotate({ identifier: "LinearBinding" })` |
| `z.object({...})` for `FileSchema` | `Schema.Struct({...})` |
| `FileSchema.safeParse(json)` + `parsed.success` check | `const decodeFile = Schema.decodeUnknownOption(FileSchema)` + `Option.getOrUndefined(decodeFile(json))` + null check |
| `parsed.data.teamId` access | `parsed.teamId` (the decoded value is already a typed `Schema.Schema.Type<typeof FileSchema>`) |

### Renaming constraint

The workspace rule forbids destructuring with renaming
(`const { a: b } = obj`). The decoded `FileSchema` value has
camelCase fields (`teamId`, `projectId`) which match the `Binding`
fields directly — no renaming needed. The new code uses object
literal spread to construct the `Binding` return value, preserving
the no-renaming rule.

## Scope boundary — `packages/opencode/src/tool/registry.ts`

`registry.ts` is **not modified**. It uses zod as the public plugin
API contract:

```typescript
// Plugin tools still expose Zod args publicly; keep that compatibility
// boxed at the registry boundary
```

This is a main-branch file outside the Todo Sidebar Feature scope.
Touching it would violate the workspace rule "Never change anything
out of the scope of Todo Sidebar Feature".

## Verification

### Stage 3.1
- `bun --cwd packages/opencode typecheck` — passes.
- `bun --cwd packages/opencode test test/issue/issue.test.ts` — 16 unit tests pass.
- `bun --cwd packages/opencode test test/tool` — 338 tool tests pass (no regressions).

### Stage 3.2
- `bun --cwd packages/opencode typecheck` — passes.
- `bun --cwd packages/opencode test test/issue` — 354 tests pass total.

## Relationship to other amendments

- **Stage 1** (archived-issue-management-realignment): removed
  `IssueArchivedError` and `Issue.patchStatus`. The schema migration
  in this stage is purely a type-system refactor — no runtime
  behavior change.
- **Stage 2** (catch-rule-source-alignment): documented the
  `.catch()` rule. No interaction with this stage.

## Open questions

None. The migration is complete; `zod` is no longer imported anywhere
in the Todo Sidebar Feature scope.
