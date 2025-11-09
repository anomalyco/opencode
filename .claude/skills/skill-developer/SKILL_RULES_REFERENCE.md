# skill-rules.json - Complete Reference

Complete schema and configuration reference for `.claude/skills/skill-rules.json`.

## Table of Contents

- [File Location](#file-location)
- [Complete TypeScript Schema](#complete-typescript-schema)
- [Field Guide](#field-guide)
- [Example: Guardrail Skill](#example-guardrail-skill)
- [Example: Domain Skill](#example-domain-skill)
- [Validation](#validation)

---

## File Location

**Path:** `.claude/skills/skill-rules.json`

This JSON file defines all skills and their trigger conditions for the auto-activation system.

---

## Complete TypeScript Schema

```typescript
interface SkillRules {
    version: string;
    skills: Record<string, SkillRule>;
}

interface SkillRule {
    type: 'guardrail' | 'domain';
    enforcement: 'block' | 'suggest' | 'warn';
    priority: 'critical' | 'high' | 'medium' | 'low';

    promptTriggers?: {
        keywords?: string[];
        intentPatterns?: string[];  // Regex strings
    };

    fileTriggers?: {
        pathPatterns: string[];     // Glob patterns
        pathExclusions?: string[];  // Glob patterns
        contentPatterns?: string[]; // Regex strings
        createOnly?: boolean;       // Only trigger on file creation
    };

    blockMessage?: string;  // For guardrails, {file_path} placeholder

    skipConditions?: {
        sessionSkillUsed?: boolean;      // Skip if used in session
        fileMarkers?: string[];          // e.g., ["@skip-validation"]
        envOverride?: string;            // e.g., "SKIP_DB_VERIFICATION"
    };
}
```

---

## Field Guide

### Top Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Schema version (currently "1.0") |
| `skills` | object | Yes | Map of skill name → SkillRule |

### SkillRule Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | "guardrail" (enforced) or "domain" (advisory) |
| `enforcement` | string | Yes | "block" (PreToolUse), "suggest" (UserPromptSubmit), or "warn" |
| `priority` | string | Yes | "critical", "high", "medium", or "low" |
| `promptTriggers` | object | Optional | Triggers for UserPromptSubmit hook |
| `fileTriggers` | object | Optional | Triggers for PreToolUse hook |
| `blockMessage` | string | Optional* | Required if enforcement="block". Use `{file_path}` placeholder |
| `skipConditions` | object | Optional | Escape hatches and session tracking |

*Required for guardrails

### promptTriggers Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keywords` | string[] | Optional | Exact substring matches (case-insensitive) |
| `intentPatterns` | string[] | Optional | Regex patterns for intent detection |

### fileTriggers Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pathPatterns` | string[] | Yes* | Glob patterns for file paths |
| `pathExclusions` | string[] | Optional | Glob patterns to exclude (e.g., test files) |
| `contentPatterns` | string[] | Optional | Regex patterns to match file content |
| `createOnly` | boolean | Optional | Only trigger when creating new files |

*Required if fileTriggers is present

### skipConditions Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionSkillUsed` | boolean | Optional | Skip if skill already used this session |
| `fileMarkers` | string[] | Optional | Skip if file contains comment marker |
| `envOverride` | string | Optional | Environment variable name to disable skill |

---

## Example: Guardrail Skill

Complete example of a blocking guardrail skill with all features:

```json
{
  "database-verification": {
    "type": "guardrail",
    "enforcement": "block",
    "priority": "critical",

    "promptTriggers": {
      "keywords": [
        "prisma",
        "database",
        "table",
        "column",
        "schema",
        "query",
        "migration"
      ],
      "intentPatterns": [
        "(add|create|implement).*?(user|login|auth|tracking|feature)",
        "(modify|update|change).*?(table|column|schema|field)",
        "database.*?(change|update|modify|migration)"
      ]
    },

    "fileTriggers": {
      "pathPatterns": [
        "**/schema.prisma",
        "**/migrations/**/*.sql",
        "database/src/**/*.ts",
        "form/src/**/*.ts",
        "email/src/**/*.ts",
        "users/src/**/*.ts",
        "projects/src/**/*.ts",
        "utilities/src/**/*.ts"
      ],
      "pathExclusions": [
        "**/*.test.ts",
        "**/*.spec.ts"
      ],
      "contentPatterns": [
        "import.*[Pp]risma",
        "PrismaService",
        "prisma\\.",
        "\\.findMany\\(",
        "\\.findUnique\\(",
        "\\.findFirst\\(",
        "\\.create\\(",
        "\\.createMany\\(",
        "\\.update\\(",
        "\\.updateMany\\(",
        "\\.upsert\\(",
        "\\.delete\\(",
        "\\.deleteMany\\("
      ]
    },

    "blockMessage": "⚠️ BLOCKED - Database Operation Detected\n\n📋 REQUIRED ACTION:\n1. Use Skill tool: 'database-verification'\n2. Verify ALL table and column names against schema\n3. Check database structure with DESCRIBE commands\n4. Then retry this edit\n\nReason: Prevent column name errors in Prisma queries\nFile: {file_path}\n\n💡 TIP: Add '// @skip-validation' comment to skip future checks",

    "skipConditions": {
      "sessionSkillUsed": true,
      "fileMarkers": [
        "@skip-validation"
      ],
      "envOverride": "SKIP_DB_VERIFICATION"
    }
  }
}
```

### Key Points for Guardrails

1. **type**: Must be "guardrail"
2. **enforcement**: Must be "block"
3. **priority**: Usually "critical" or "high"
4. **blockMessage**: Required, clear actionable steps
5. **skipConditions**: Session tracking prevents repeated nagging
6. **fileTriggers**: Usually has both path and content patterns
7. **contentPatterns**: Catch actual usage of technology

---

## Example: Domain Skill

Complete example of a suggestion-based domain skill:

```json
{
  "project-catalog-developer": {
    "type": "domain",
    "enforcement": "suggest",
    "priority": "high",

    "promptTriggers": {
      "keywords": [
        "layout",
        "layout system",
        "grid",
        "grid layout",
        "toolbar",
        "column",
        "cell editor",
        "cell renderer",
        "submission",
        "submissions",
        "blog dashboard",
        "datagrid",
        "data grid",
        "CustomToolbar",
        "GridLayoutDialog",
        "useGridLayout",
        "auto-save",
        "column order",
        "column width",
        "filter",
        "sort"
      ],
      "intentPatterns": [
        "(how does|how do|explain|what is|describe).*?(layout|grid|toolbar|column|submission|catalog)",
        "(add|create|modify|change).*?(toolbar|column|cell|editor|renderer)",
        "blog dashboard.*?"
      ]
    },

    "fileTriggers": {
      "pathPatterns": [
        "frontend/src/features/submissions/**/*.tsx",
        "frontend/src/features/submissions/**/*.ts"
      ],
      "pathExclusions": [
        "**/*.test.tsx",
        "**/*.test.ts"
      ]
    }
  }
}
```

### Key Points for Domain Skills

1. **type**: Must be "domain"
2. **enforcement**: Usually "suggest"
3. **priority**: "high" or "medium"
4. **blockMessage**: Not needed (doesn't block)
5. **skipConditions**: Optional (less critical)
6. **promptTriggers**: Usually has extensive keywords
7. **fileTriggers**: May have only path patterns (content less important)

---

## Validation

### Check JSON Syntax

```bash
cat .claude/skills/skill-rules.json | jq .
```

If valid, jq will pretty-print the JSON. If invalid, it will show the error.

### Common JSON Errors

**Trailing comma:**
```json
{
  "keywords": ["one", "two",]  // ❌ Trailing comma
}
```

**Missing quotes:**
```json
{
  type: "guardrail"  // ❌ Missing quotes on key
}
```

**Single quotes (invalid JSON):**
```json
{
  'type': 'guardrail'  // ❌ Must use double quotes
}
```

### Validation Checklist

- [ ] JSON syntax valid (use `jq`)
- [ ] All skill names match SKILL.md filenames
- [ ] Guardrails have `blockMessage`
- [ ] Block messages use `{file_path}` placeholder
- [ ] Intent patterns are valid regex (test on regex101.com)
- [ ] File path patterns use correct glob syntax
- [ ] Content patterns escape special characters
- [ ] Priority matches enforcement level
- [ ] No duplicate skill names

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main skill guide
- [TRIGGER_TYPES.md](TRIGGER_TYPES.md) - Complete trigger documentation
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Debugging configuration issues
