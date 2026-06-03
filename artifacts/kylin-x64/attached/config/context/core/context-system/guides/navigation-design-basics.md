<!-- Context: core/navigation-design-basics | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Designing Navigation Files

**Purpose**: How to create token-efficient, scannable navigation files

---

## Prerequisites

- Understand MVI principle (`context-system/standards/mvi.md`)
- Know your category's organizational pattern
- Have content files already created

**Estimated time**: 15-20 min per navigation file

---

## Core Principles

### 1. Token Efficiency
**Goal**: 200-300 tokens per navigation file

**How**:
- Use ASCII trees (not verbose descriptions)
- Use tables (not paragraphs)
- Be concise (not comprehensive)

### 2. Scannable Structure
**Goal**: AI can find what it needs in <5 seconds

**Format**:
1. **Structure** (ASCII tree) - See what exists
2. **Quick Routes** (table) - Jump to common tasks
3. **By Concern/Type** (sections) - Browse by category

### 3. Self-Contained
**Include**: ✅ Paths | ✅ Brief descriptions (3-5 words) | ✅ When to use
**Exclude**: ❌ File contents | ❌ Detailed explanations | ❌ Duplicates

---

## Steps

### 1. Determine Navigation Type

| Type | Path | Purpose |
|------|------|---------|
| Category-level | `{category}/navigation.md` | Overview of category |
| Subcategory-level | `{category}/{sub}/navigation.md` | Files in subcategory |
| Specialized | `{category}/{domain}-navigation.md` | Cross-cutting (e.g., ui-navigation.md) |

### 2. Create Structure Section

```markdown
## Structure

```
openagents-repo/
├── navigation.md
├── quick-start.md
├── concepts/
│   └── subagent-testing-modes.md
├── guides/
│   ├── adding-agent.md
│   └── testing-agent.md
└── lookup/
    └── commands.md
```
```

**Token count**: ~50-100 tokens

### 3. Create Quick Routes Table

```markdown
## Quick Routes

| Task | Path |
|------|------|
| **Add agent** | `guides/adding-agent.md` |
| **Test agent** | `guides/testing-agent.md` |
| **Find files** | `lookup/file-locations.md` |
```

**Guidelines**: Use **bold** for tasks | Relative paths | 5-10 common tasks

### 4. Create By Concern/Type Sections

```markdown
## By Type

**Concepts** → Core ideas and principles
**Guides** → Step-by-step workflows
**Lookup** → Quick reference tables
**Errors** → Troubleshooting
```

### 5. Add Related Context (Optional)

```markdown
## Related Context

- **Core Standards** → `../core/standards/navigation.md`
```

### 6. Validate Token Count

**Target**: 200-300 tokens

```bash
wc -w navigation.md  # Multiply by 1.3 for token estimate
```

---

## Verification Checklist

- [ ] Token count 200-300?
- [ ] ASCII tree included?
- [ ] Quick routes table?
- [ ] By concern/type section?
- [ ] Relative paths?
- [ ] Descriptions 3-5 words?
- [ ] No duplicate information?

---

## Related

- `navigation-templates.md` - Ready-to-use templates
- `../standards/mvi.md` - MVI principle
- `../examples/navigation-examples.md` - More examples
