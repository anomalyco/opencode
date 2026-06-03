<!-- Context: core/structure | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Context Structure

**Purpose**: Function-based folder organization for easy discovery

**Last Updated**: 2026-01-06

---

## Core Structure

<rule id="function_structure" enforcement="strict">
  ALWAYS organize by function (what info does), not just by topic.
  
  Required folders:
  - concepts/  - Core ideas, definitions, "what is it?"
  - examples/  - Minimal working code
  - guides/    - Step-by-step workflows
  - lookup/    - Quick reference tables, commands, paths
  - errors/    - Common issues, gotchas, fixes
</rule>

```
/Users/apple/.config/opencode/context/{category}/
├── navigation.md              # Navigation map (REQUIRED)
├── concepts/              # What it is
│   └── {topic}.md
├── examples/              # Working code
│   └── {example}.md
├── guides/                # How to do it
│   └── {guide}.md
├── lookup/                # Quick reference
│   └── {reference}.md
└── errors/                # Common issues
    └── {framework}.md
```

---

## Folder Purposes

### concepts/
**Purpose**: Core ideas, definitions, "what is it?"

**Contains**:
- Fundamental concepts
- Design patterns
- Architecture decisions
- System principles

**Examples**:
- `concepts/authentication.md`
- `concepts/state-management.md`
- `concepts/mvi-principle.md`

---

### examples/
**Purpose**: Minimal working code examples

**Contains**:
- Code snippets that work as-is
- Minimal reproductions
- Common patterns in action

**Examples**:
- `examples/jwt-auth-example.md`
- `examples/react-hooks-example.md`
- `examples/api-call-example.md`

**Rule**: Examples should be <30 lines of code, fully functional

---

### guides/
**Purpose**: Step-by-step workflows, "how to do X"

**Contains**:
- Numbered procedures
- Setup instructions
- Implementation workflows
- Migration guides

**Examples**:
- `guides/setting-up-auth.md`
- `guides/deploying-api.md`
- `guides/migrating-to-v2.md`

**Rule**: Steps should be actionable (not theoretical)

---

### lookup/
**Purpose**: Quick reference tables, commands, paths

**Contains**:
- Command lists
- File locations
- API endpoints
- Configuration options
- Keyboard shortcuts

**Examples**:
- `lookup/cli-commands.md`
- `lookup/file-locations.md`
- `lookup/api-endpoints.md`

**Rule**: Must be in table/list format (scannable)

---

### errors/
**Purpose**: Common errors, gotchas, edge cases

**Contains**:
- Error messages + fixes
- Common pitfalls
- Edge cases
- Troubleshooting

**Examples**:
- `errors/react-errors.md`
- `errors/nextjs-build-errors.md`
- `errors/auth-errors.md`

**Rule**: Group by framework/topic, not one file per error

---

## navigation.md Requirement

<rule id="readme_required" enforcement="strict">
  Every context category MUST have navigation.md at its root with:
  1. Purpose (1-2 sentences)
  2. Navigation tables for each function folder
  3. Priority levels (critical/high/medium/low)
  4. Loading strategy (what to load for common tasks)
</rule>

**Example**:
```markdown
# Development Context

**Purpose**: Core development patterns, errors, and examples

---

## Quick Navigation

### Concepts
| File | Description | Priority |
|------|-------------|----------|
| concepts/auth.md | Authentication patterns | critical |

### Examples
| File | Description | Priority |
|------|-------------|----------|
| examples/jwt.md | JWT auth example | high |

### Errors
| File | Description | Priority |
|------|-------------|----------|
| errors/react.md | Common React errors | high |

---

## Loading Strategy

**For auth work**: 
1. Load concepts/auth.md
2. Load examples/jwt.md
3. Reference guides/setup-auth.md if needed
```

---

## Categorization Rules

When organizing a file, ask:

| Question | Folder |
|----------|--------|
| Does it explain **what** something is? | `concepts/` |
| Does it show **working code**? | `examples/` |
| Does it explain **how to do** something? | `guides/` |
| Is it **quick reference** data? | `lookup/` |
| Does it document an **error/issue**? | `errors/` |

---

## Anti-Patterns ❌

### ❌ Flat Structure
```
development/
├── authentication.md
├── jwt-example.md
├── setting-up-auth.md
├── auth-errors.md
└── api-endpoints.md
```
**Problem**: Hard to discover. Is authentication.md a concept or guide?

### ✅ Function-Based
```
development/
├── navigation.md
├── concepts/
│   └── authentication.md
├── examples/
│   └── jwt-example.md
├── guides/
│   └── setting-up-auth.md
├── lookup/
│   └── api-endpoints.md
└── errors/
    └── auth-errors.md
```
**Benefit**: Instantly know file purpose by location

---

## Validation

Before committing context structure:

- [ ] All categories have navigation.md?
- [ ] Files are in function folders (not flat)?
- [ ] README has navigation tables?
- [ ] Priority levels assigned?
- [ ] Loading strategy documented?

---

## Related

- mvi-principle.md - What to extract
- templates.md - File formats
- creation.md - How to create files
