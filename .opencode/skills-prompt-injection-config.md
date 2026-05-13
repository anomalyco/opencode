# Config Change: `skills.prompt_injection`

## Overview

Add a new configuration option to control how skill descriptions are injected into the model's context. This allows per-model tuning of the skill discovery vs. token efficiency trade-off.

## Config Schema

### Location

`.opencode/opencode.jsonc`

### Definition

```jsonc
{
  "skills": {
    "prompt_injection": "triple" | "dual" | "single" | "none"
  }
}
```

### Values

| Value | Behavior | Token Cost | Use Case |
|-------|----------|------------|----------|
| `"triple"` | System prompt + tool description + system reminder | ~5-7K | Maximum discoverability, token budget not a concern |
| `"dual"` | Tool description + system reminder | ~3-4K | Balanced approach |
| `"single"` | Tool description only | ~1-2K | Token efficiency, model reads tool descriptions well |
| `"none"` | No injection at all | ~0 | Testing baseline, or when skills are not needed |

### Default

**`"triple"`** — maintains current behavior for backward compatibility.

### Scope

This config is **global** (not per-model). Future enhancement could add per-model overrides:

```jsonc
{
  "skills": {
    "prompt_injection": "triple",
    "per_model": {
      "llama.cpp/qwen3.6": "single",
      "openai/gpt-4o": "triple"
    }
  }
}
```

## Implementation

### Files to Modify

1. **`config/schema.json`** — Add `skills.prompt_injection` to the config schema
2. **`config/loader.ts`** — Parse and validate the new config option
3. **`agent/context.ts`** (or equivalent) — Conditionally inject skill descriptions based on config
4. **`tool/skill.ts`** — Conditionally include system reminder based on config

### Code Changes

#### 1. Config Schema (`config/schema.json`)

Add to the root config schema:

```jsonc
{
  "properties": {
    "skills": {
      "type": "object",
      "properties": {
        "prompt_injection": {
          "type": "string",
          "enum": ["triple", "dual", "single", "none"],
          "default": "triple",
          "description": "Controls how skill descriptions are injected into the model context. 'triple' = system prompt + tool description + system reminder. 'dual' = tool description + system reminder. 'single' = tool description only. 'none' = no injection."
        }
      }
    }
  }
}
```

#### 2. Config Loader (`config/loader.ts`)

No changes needed if using existing schema validation. The new field will be parsed automatically.

#### 3. Context Builder (`agent/context.ts`)

Modify the system prompt construction to conditionally include `<available_skills>`:

```typescript
// Before: always injects skills
function buildSystemPrompt(config, skills) {
  return `
${basePrompt}
<available_skills>
${formatSkills(skills)}
</available_skills>
`;
}

// After: conditional injection
function buildSystemPrompt(config, skills) {
  const injection = config.skills?.prompt_injection ?? "triple";
  let prompt = basePrompt;
  
  if (injection === "triple" || injection === "dual") {
    prompt += `\n<available_skills>\n${formatSkills(skills)}\n</available_skills>`;
  }
  
  return prompt;
}
```

#### 4. Skill Tool (`tool/skill.ts`)

Modify the system reminder injection:

```typescript
// Before: always injects system reminder
function onSessionStart(config, skills) {
  return `<dcp-system-reminder>\nThe following skills are available:\n${formatSkills(skills)}\n</dcp-system-reminder>`;
}

// After: conditional injection
function onSessionStart(config, skills) {
  const injection = config.skills?.prompt_injection ?? "triple";
  
  if (injection === "triple") {
    return `<dcp-system-reminder>\nThe following skills are available:\n${formatSkills(skills)}\n</dcp-system-reminder>`;
  }
  
  return null; // No reminder for 'dual', 'single', or 'none'
}
```

### Migration Path

1. **Phase 1:** Add config option with default `"triple"` (no behavior change)
2. **Phase 2:** Run evaluation (see `skills-evaluation-spec.md`)
3. **Phase 3:** Update default based on evaluation results (if recommended)
4. **Phase 4:** Add per-model overrides (optional, future)

### Estimated Effort

- **Config schema:** ~10 lines
- **Context builder:** ~20 lines
- **Skill tool:** ~10 lines
- **Tests:** ~10 lines
- **Total:** ~50 lines

## Testing

### Unit Tests

1. **Config validation** — Ensure only valid values are accepted
2. **Default value** — Ensure `"triple"` is used when config is absent
3. **Context injection** — Verify skills appear/disappear based on config
4. **System reminder** — Verify reminder appears/disappears based on config

### Integration Tests

1. Run a task with each config value and verify skill invocation behavior
2. Measure token count for each config value
3. Verify backward compatibility (no config = current behavior)

## Open Questions

- Should we add a `"smart"` mode that dynamically adjusts based on context window usage?
- Should the config be hot-reloadable (no restart needed)?
- Should we expose this in the TUI config editor?
