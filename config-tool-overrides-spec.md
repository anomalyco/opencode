# Spec: Config-Based Tool Description Overrides

## Problem

Opencode's built-in tool descriptions are hardcoded in `.txt` files and cannot be customized. This creates issues:

1. **Token waste** — Verbose descriptions (e.g., `read.txt` is ~1100 chars) consume prompt tokens unnecessarily
2. **Conflicting instructions** — Hardcoded bash instructions say "use gh command" but users may use GitLab/glab
3. **No project customization** — Different projects may need different tool guidance
4. **No parameter hiding** — Can't strip parameter schemas to reduce token usage

## Proposed Solution

Add a `tools` field to `opencode.jsonc` that allows overriding tool descriptions and parameter schemas.

## Config Schema

### Location

- Global: `~/.config/opencode/opencode.jsonc`
- Project: `.opencode/opencode.jsonc` or `opencode.jsonc`

### Format

```jsonc
{
  "tools": {
    // String = replace description only
    "read": "Read file contents",
    "bash": "",                              // empty = no description
    
    // Object = full control
    "glob": {
      "description": "Find files by pattern",
      "stripParameters": true
    },
    
    // Boolean = enable/disable (existing behavior preserved)
    "websearch": false
  }
}
```

### Schema Definition

In `packages/opencode/src/config/config.ts`, change:

```typescript
// BEFORE (line 244)
tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),

// AFTER
tools: Schema.optional(Schema.Record(
  Schema.String,
  Schema.Union(
    Schema.Boolean,                              // enable/disable (existing)
    Schema.String,                               // override description
    Schema.Struct({                              // full control
      description: Schema.String,
      stripParameters: Schema.optional(Schema.Boolean),
    })
  )
)),
```

## Implementation

### File 1: `packages/opencode/src/config/config.ts`

Change the `tools` field schema (line ~244) to accept strings and objects in addition to booleans.

### File 2: `packages/opencode/src/tool/registry.ts`

In the tool registration logic (~line 151), apply config overrides before using `def.description`:

```typescript
// Get tool override from config
const configTools = config.tools as Record<string, string | { description: string; stripParameters?: boolean } | boolean> | undefined
const toolOverride = configTools?.[def.id]

let description = def.description
let stripParameters = false

if (typeof toolOverride === "string") {
  description = toolOverride
} else if (typeof toolOverride === "object" && toolOverride !== null) {
  description = toolOverride.description ?? def.description
  stripParameters = toolOverride.stripParameters ?? false
}

// Use overridden description
return {
  id: def.id,
  parameters: stripParameters ? /* empty schema */ def.parameters,
  description,
  // ... rest of tool definition
}
```

### File 3: `packages/opencode/src/tool/registry.ts` (parameter stripping)

When `stripParameters: true`, replace the tool's parameter schema with an empty object `{}`:

```typescript
const parameters = stripParameters 
  ? Schema.declare<unknown>(() => true).annotate({ [ZodOverride]: z.object({}) })
  : def.parameters
```

## Behavior

### Priority

1. Tool-specific override (in `tools` map)
2. No fallback — if tool not in `tools` map, original definition is used
3. Boolean `false` disables the tool entirely (existing behavior)

### Parameter Stripping

When `stripParameters: true`, the tool's parameter schema is replaced with an empty object. The tool still appears in the tool list but with no parameter details sent to the LLM.

### Empty String

Setting `description: ""` or `"toolName": ""` results in no description being sent to the LLM.

### Backward Compatibility

- Existing `tools: { "websearch": false }` config continues to work
- New string/object values are additive — they don't break existing configs
- Tools not mentioned in config use original descriptions

## Example Configs

### Minimal — strip all descriptions

```jsonc
{
  "tools": {
    "bash": "",
    "read": "",
    "write": "",
    "edit": "",
    "glob": "",
    "grep": "",
    "webfetch": "",
    "websearch": "",
    "task": "",
    "todowrite": "",
    "skill": ""
  }
}
```

### Selective — short descriptions + strip parameters

```jsonc
{
  "tools": {
    "read": "Read file",
    "write": "Write file",
    "glob": { "description": "Find files", "stripParameters": true },
    "grep": { "description": "Search files", "stripParameters": true },
    "edit": "Edit file"
  }
}
```

### GitLab workflow — fix conflicting bash instructions

```jsonc
{
  "tools": {
    "bash": "Execute shell commands. Use glab for GitLab operations."
  }
}
```

## Token Savings Estimate

| Tool | Original | With "" | Saved |
|------|----------|---------|-------|
| read | ~1100 chars (~363 tokens) | 0 | 363 |
| bash | ~800 chars (~267 tokens) | 0 | 267 |
| edit | ~1300 chars (~433 tokens) | 0 | 433 |
| glob | ~500 chars (~167 tokens) | 0 | 167 |
| grep | ~650 chars (~217 tokens) | 0 | 217 |
| **Total (11 tools)** | **~8000 chars** | **~1000 chars** | **~6000 chars (~2000 tokens)** |

## Testing

### Unit Tests

- Config schema accepts strings, objects, and booleans
- String override replaces description
- Object override replaces description and optionally strips parameters
- Boolean `false` disables tool (existing behavior)
- Tool not in config uses original description
- Empty string results in empty description

### Integration Tests

- Config loaded from project `.opencode/opencode.jsonc`
- Config loaded from global `~/.config/opencode/opencode.jsonc`
- Project config overrides global config
- Multiple tools overridden in single config

## Files Changed

| File | Lines Changed | Description |
|------|---------------|-------------|
| `packages/opencode/src/config/config.ts` | ~10 | Extend `tools` schema |
| `packages/opencode/src/tool/registry.ts` | ~25 | Apply overrides during registration |
| `packages/opencode/src/config/config.test.ts` | ~30 | Schema tests |
| `packages/opencode/src/tool/registry.test.ts` | ~40 | Override tests |

**Total: ~105 lines of code + tests**

## Related Issues

- [#11604](https://github.com/anomalyco/opencode/issues/11604) — Main feature request
- [#7362](https://github.com/anomalyco/opencode/issues/7362) — Tool descriptions as skills
- [#5715](https://github.com/anomalyco/opencode/issues/5715) — Overly long bash description
- [#9570](https://github.com/anomalyco/opencode/issues/9570) — Gemini API tool description trimming
