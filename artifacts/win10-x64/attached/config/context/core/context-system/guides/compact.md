<!-- Context: core/compact | Priority: high | Version: 1.1 | Updated: 2026-02-15 -->

# Context Compaction (Minimization)

**Purpose**: Compress verbose content into minimal viable information

**Last Updated**: 2026-02-15

---

## Core Idea

Transform verbose explanations → core concepts following MVI principle.

**Formula**: Verbose Content → Core Concept (1-3 sentences) → Key Points (3-5 bullets) → Minimal Example (<10 lines) → Reference Link → Compact File

---

## 5 Compression Techniques

### 1. Extract Core Concept
**From**: Paragraphs → **To**: 1-3 sentences  
**Rule**: If you can't explain it in 3 sentences, simplify further.

### 2. Bulletize Key Points
**From**: Long paragraphs → **To**: 3-5 bullet points  
**Rule**: Each bullet = one key fact. No sub-bullets.

### 3. Minimize Examples
**From**: Full implementations → **To**: Smallest working example (<10 lines)  
**Rule**: Show the simplest case. Link to full examples.

### 4. Replace Repetition with References
**From**: Same info repeated → **To**: Define once, reference with links  
**Rule**: Say it once in concepts/, reference everywhere else.

### 5. Convert Prose to Tables
**From**: Paragraphs listing things → **To**: Scannable tables  
**Rule**: If listing >3 items, use a table or bullets.

---

## Compaction Checklist

- [ ] Core concept is 1-3 sentences?
- [ ] Key points are 3-5 bullets (no sub-bullets)?
- [ ] Example is <10 lines of code?
- [ ] No repeated explanations?
- [ ] Reference link added for deep dive?
- [ ] File is under line limit?
- [ ] Can be scanned in <30 seconds?

---

## Common Bloat Patterns to Remove

| Bloat Type | ❌ Avoid | ✅ Use Instead |
|------------|---------|---------------|
| Over-Explaining | "This is important because it allows you to manage state in a more efficient way..." | "Manages state efficiently" |
| Historical Context | "Before React 16.8, we used class components..." | Skip history unless critical |
| Multiple Examples | Example 1, 2, 3, 4... | ONE simple example + link |
| Implementation Details | "The internal implementation uses a fiber architecture..." | Skip internals, show usage |

---

## Target Line Counts

| File Type | Target | Max |
|-----------|--------|-----|
| Concept | 40-60 | 100 |
| Example | 30-50 | 80 |
| Guide | 60-100 | 150 |
| Lookup | 20-40 | 100 |
| Error | 50-80 | 150 |

**Philosophy**: If you hit max lines, split into multiple files or reference external docs.

---

## The 30-Second Rule

<rule id="thirty_second_rule" enforcement="strict">
  Every context file must be scannable in <30 seconds.
</rule>

**Test**: Can someone unfamiliar explain it back in 30 seconds?

---

## Quick Example

**Before (150 lines)**: Long authentication system explanation with edge cases, examples, etc.

**After (45 lines)**:
```markdown
# Concept: Authentication

**Core Idea**: JWT-based stateless auth. Token in httpOnly cookie, verified on every request.

**Key Points**:
- Token has userId + role claims
- Expires in 1 hour (refresh token for renewal)
- Stored in httpOnly cookie (XSS protection)
- Verified via middleware on protected routes

**Quick Example**:
```js
const token = jwt.sign({ userId: 123 }, SECRET, { expiresIn: '1h' })
res.cookie('auth', token, { httpOnly: true })
```

**Reference**: https://docs.company.com/auth
**Related**: examples/jwt-auth.md, errors/auth-errors.md
```

---

## Related

- mvi.md - MVI principle
- harvest.md - When to compact
- templates.md - Standard formats
