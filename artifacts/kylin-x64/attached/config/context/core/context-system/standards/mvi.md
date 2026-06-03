<!-- Context: core/mvi | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# MVI Principle (Minimal Viable Information)

**Purpose**: Extract only core concepts, not verbose explanations

**Last Updated**: 2026-01-06

---

## Core Idea

Extract the **minimum information** needed for an AI agent to understand and use a concept:
- Core concept (1-3 sentences)
- Key points (3-5 bullets)
- Minimal working example
- Reference link to full docs

**Goal**: Scannable in <30 seconds. Reference full docs, don't duplicate them.

---

## The Formula

```
Core Concept (1-3 sentences)
  ↓
Key Points (3-5 bullets)
  ↓
Quick Example (5-10 lines)
  ↓
Reference Link (full docs)
  ↓
Related Files (cross-refs)
```

---

## What to Extract ✅

- **Core definitions** - What it is (1-3 sentences)
- **Key properties** - Essential characteristics (3-5 bullets)
- **Minimal example** - Simplest working code (5-10 lines)
- **Common patterns** - How it's typically used (2-3 bullets)
- **Critical gotchas** - Must-know issues (1-2 bullets)
- **Reference links** - Where to learn more

---

## What to Skip ❌

- **Verbose explanations** - Link to docs instead
- **Complete API docs** - Summarize + reference
- **Implementation details** - Show minimal example + reference
- **Historical context** - Unless critical to understanding
- **Marketing content** - Just the facts
- **Duplicate information** - Say it once, reference elsewhere

---

## Example: JWT Authentication

### ❌ Too Verbose (400+ lines)
```markdown
# JWT Authentication

JSON Web Tokens (JWT) are an open standard (RFC 7519) that defines 
a compact and self-contained way for securely transmitting information 
between parties as a JSON object. This information can be verified and 
trusted because it is digitally signed. JWTs can be signed using a 
secret (with the HMAC algorithm) or a public/private key pair using RSA 
or ECDSA.

[... 400 more lines of explanation, examples, edge cases ...]
```

### ✅ MVI Compliant (~50 lines)
```markdown
# Concept: JWT Authentication

**Core Idea**: Stateless authentication using JSON Web Tokens signed 
with a secret key. Token contains user data (payload) that server can 
trust because signature is verified.

**Key Points**:
- Token has 3 parts: header.payload.signature (Base64 encoded)
- Server verifies signature to trust payload without database lookup
- No session storage needed (stateless)
- Tokens expire (include `exp` claim)
- Store in httpOnly cookie or Authorization header

**Quick Example**:
```js
// Sign token
const token = jwt.sign(
  { userId: 123, role: 'admin' }, 
  SECRET_KEY, 
  { expiresIn: '1h' }
)

// Verify token
const decoded = jwt.verify(token, SECRET_KEY)
console.log(decoded.userId) // 123
```

**Reference**: https://jwt.io/introduction

**Related**: 
- examples/jwt-auth-example.md
- guides/implementing-jwt.md
- errors/auth-errors.md
```

---

## File Size Limits

<rule id="size_limits" enforcement="strict">
  - Concept files: max 100 lines
  - Example files: max 80 lines
  - Guide files: max 150 lines
  - Lookup files: max 100 lines
  - Error files: max 150 lines
  - README files: max 100 lines
</rule>

**Why**: Forces brevity. If you need more, split into multiple files or reference external docs.

---

## Validation Checklist

Before creating a context file, verify:

- [ ] Core concept is 1-3 sentences?
- [ ] Key points are 3-5 bullets?
- [ ] Example is <10 lines of code?
- [ ] Reference link is included?
- [ ] File is <200 lines total?
- [ ] Can be scanned in <30 seconds?

If any answer is "no", apply more compression.

---

## Related

- structure.md - Where files go
- compact.md - How to minimize
- templates.md - Standard formats
- creation.md - File creation rules
