<!-- Context: core/navigation-templates | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Navigation File Templates

**Purpose**: Ready-to-use templates for navigation files

---

## Category Navigation Template

```markdown
# {Category} Navigation

**Purpose**: [1 sentence]

---

## Structure

```
{category}/
├── navigation.md
├── {subcategory}/
│   ├── navigation.md
│   └── {files}.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **{Task 1}** | `{path}` |
| **{Task 2}** | `{path}` |
| **{Task 3}** | `{path}` |

---

## By {Concern/Type}

**{Section 1}** → {description}
**{Section 2}** → {description}
**{Section 3}** → {description}

---

## Related Context

- **{Category}** → `../{category}/navigation.md`
```

**Token count**: ~200-250 tokens

---

## Specialized Navigation Template

```markdown
# {Domain} Navigation

**Scope**: [What this covers]

---

## Structure

```
{Relevant directories across multiple categories}
```

---

## Quick Routes

| Task | Path |
|------|------|
| **{Task 1}** | `{path}` |
| **{Task 2}** | `{path}` |

---

## By {Framework/Approach}

**{Tech 1}** → `{path}`
**{Tech 2}** → `{path}`

---

## Common Workflows

**{Workflow 1}**:
1. `{file1}` ({purpose})
2. `{file2}` ({purpose})
```

**Token count**: ~250-300 tokens

---

## Good Example (Token-Efficient)

```markdown
# Development Navigation

**Purpose**: Software development across all stacks

---

## Structure

```
development/
├── navigation.md
├── ui-navigation.md
├── principles/
├── frontend/
├── backend/
└── data/
```

---

## Quick Routes

| Task | Path |
|------|------|
| **UI/Frontend** | `ui-navigation.md` |
| **Backend/API** | `backend-navigation.md` |
| **Clean code** | `principles/clean-code.md` |

---

## By Concern

**Principles** → Universal practices
**Frontend** → React, Vue, state
**Backend** → APIs, Node, auth
**Data** → SQL, NoSQL, ORMs
```

**Token count**: ~180 tokens ✅

---

## Bad Example (Too Verbose)

```markdown
# Development Navigation

**Purpose**: This navigation file helps you find software development 
patterns, standards, and best practices across all technology stacks 
including frontend, backend, databases, and infrastructure.

---

## Introduction

The development category contains comprehensive guides and patterns 
for building modern applications. Whether you're working on frontend 
user interfaces, backend APIs, database integrations...

[... continues for 500+ tokens]
```

**Token count**: 500+ tokens ❌

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Too many tokens | Remove verbose descriptions, shorten entries |
| Hard to scan | Use tables instead of paragraphs |
| Missing files | Add to structure and quick routes |
| Unclear paths | Use relative paths, add brief descriptions |

---

## Related

- `navigation-design-basics.md` - Core principles and steps
- `../standards/mvi.md` - MVI principle
- `../examples/navigation-examples.md` - More examples
