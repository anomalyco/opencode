# Context File Templates

**Purpose**: Standard formats for all context file types

**Last Updated**: 2026-01-06

---

## Template Selection

| Type | Max Lines | Required Sections |
|------|-----------|-------------------|
| Concept | 100 | Purpose, Core Idea (1-3 sentences), Key Points (3-5), Example (<10 lines), Reference, Related |
| Example | 80 | Purpose, Use Case, Code (10-30 lines), Explanation, Related |
| Guide | 150 | Purpose, Prerequisites, Steps (4-7), Verification, Related |
| Lookup | 100 | Purpose, Tables/Lists, Commands, Related |
| Error | 150 | Purpose, Per-error: Symptom, Cause, Solution, Prevention, Reference, Related |
| README | 100 | Purpose, Navigation tables (all 5 folders), Loading Strategy, Statistics |

---

## 1. Concept Template

```markdown
<!-- Context: {category}/concepts | Priority: {critical|high|medium|low} | Version: 1.0 | Updated: YYYY-MM-DD -->
# Concept: {Name}

**Purpose**: [1 sentence]
**Last Updated**: {YYYY-MM-DD}

## Core Idea
[1-3 sentences]

## Key Points
- Point 1
- Point 2
- Point 3

## When to Use
- Use case 1
- Use case 2

## Quick Example
```lang
[<10 lines]
```

## 📂 Codebase References

**Business Logic** (if business domain):
- `path/to/rules.ts` - {3-10 word description}

**Implementation**:
- `path/to/main.ts` - {3-10 word description}

**Models/Types**:
- `path/to/model.ts` - {3-10 word description}

**Tests**:
- `path/to/test.ts` - {3-10 word description}

## Deep Dive
**Reference**: [Link or "See implementation above"]

## Related
- concepts/x.md
- examples/y.md
```

---

## 2. Example Template

```markdown
<!-- Context: {category}/examples | Priority: {high|medium} | Version: 1.0 | Updated: YYYY-MM-DD -->
# Example: {What It Shows}

**Purpose**: [1 sentence]
**Last Updated**: {YYYY-MM-DD}

## Use Case
[2-3 sentences]

## Code
```lang
[10-30 lines]
```

## Explanation
1. Step 1
2. Step 2
3. Step 3

**Key points**:
- Detail 1
- Detail 2

## 📂 Codebase References

**Full Implementation**:
- `path/to/real-implementation.ts` - {Production version}

**Related Code**:
- `path/to/helper.ts` - {Helper utilities}

**Tests**:
- `path/to/test.ts` - {Tests demonstrating pattern}

## Related
- concepts/x.md
```

---

## 3. Guide Template

```markdown
<!-- Context: {category}/guides | Priority: {critical|high|medium} | Version: 1.0 | Updated: YYYY-MM-DD -->
# Guide: {Action}

**Purpose**: [1 sentence]
**Last Updated**: {YYYY-MM-DD}

## Prerequisites
- Requirement 1
- Requirement 2

**Estimated time**: X min

## Steps

### 1. {Step}
```bash
{command}
```
**Expected**: [result]
**Implementation**: `path/to/step.ts`

### 2. {Step}
[Repeat 4-7 steps]

## Verification
```bash
{verify command}
```

## 📂 Codebase References

**Workflow Orchestration**:
- `path/to/workflow.ts` - {Main workflow coordinator}

**Business Logic** (if applicable):
- `path/to/rules.ts` - {Process validation rules}

**Integration Points**:
- `path/to/api-client.ts` - {External integration}

**Tests**:
- `path/to/workflow.test.ts` - {End-to-end tests}

## Troubleshooting
| Issue | Solution |
|-------|----------|
| Problem | Fix |

## Related
- concepts/x.md
```

---

## 4. Lookup Template

```markdown
<!-- Context: {category}/lookup | Priority: {high|medium} | Version: 1.0 | Updated: YYYY-MM-DD -->
# Lookup: {Reference Type}

**Purpose**: Quick reference for {desc}
**Last Updated**: {YYYY-MM-DD}

## {Section}
| Item | Value | Desc | Code |
|------|-------|------|------|
| x | y | z | `path/to/file.ts` |

## Commands
```bash
# Description
{command}
```

## Paths
```
{path} - {desc}
```

## 📂 Codebase References

**Validation/Enforcement**:
- `path/to/validator.ts` - {Validation logic}

**Configuration**:
- `path/to/config.ts` - {Configuration settings}

**Tests**:
- `path/to/test.ts` - {Validation tests}

## Related
- concepts/x.md
```

---

## 5. Error Template

```markdown
<!-- Context: {category}/errors | Priority: {high|medium} | Version: 1.0 | Updated: YYYY-MM-DD -->
# Errors: {Framework}

**Purpose**: Common errors for {framework}
**Last Updated**: {YYYY-MM-DD}

## Error: {Name}

**Symptom**:
```
{error message}
```

**Cause**: [1-2 sentences]

**Solution**:
1. Step 1
2. Step 2

**Code**:
```lang
// ❌ Before
{bad}

// ✅ After
{fixed}
```

**Prevention**: [how to avoid]
**Frequency**: common/occasional/rare

**Code References**:
- Error thrown: `path/to/error-source.ts`
- Error handler: `path/to/error-handler.ts`
- Prevention: `path/to/validator.ts`

---

[Repeat for 5-10 errors]

## 📂 Codebase References

**Error Definitions**:
- `path/to/error-types.ts` - {Error class definitions}

**Error Handling**:
- `path/to/error-handler.ts` - {Error handler}

**Prevention Logic**:
- `path/to/validator.ts` - {Validation preventing errors}

**Tests**:
- `path/to/error-handling.test.ts` - {Error handling tests}

## Related
- concepts/x.md
```

---

## 6. Navigation Template (Replaces README.md)

**Note**: Use `navigation.md` instead of `README.md` for better discoverability

**Target**: 200-300 tokens

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

---

## 7. Specialized Navigation Template

**Use for**: Cross-cutting concerns (e.g., `ui-navigation.md`)

**Target**: 250-300 tokens

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

---

## All Templates Must Have

1. Title with type prefix (# Concept:, # Example:, etc.)
2. **Purpose** (1 sentence)
3. **Last Updated** (YYYY-MM-DD)
4. **Related** section (cross-references)

---

## Validation

- [ ] Correct template for file type?
- [ ] Has required sections?
- [ ] Under max line limit?
- [ ] Cross-references added?
- [ ] Added to README.md?

---

## Related

- creation.md - When to use each template
- mvi-principle.md - How to fill templates
- compact.md - How to stay under limits
