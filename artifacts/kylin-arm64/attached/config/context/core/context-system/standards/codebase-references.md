<!-- Context: core/codebase-references | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Codebase References

**Purpose**: Link context files to actual code implementation

**Last Updated**: 2026-01-27

---

## Core Principle

<rule id="link_to_code" enforcement="critical">
  ALL context files SHOULD include `📂 Codebase References` section linking to relevant code.
  Use sections that apply to your context type (not all files need all sections).
</rule>

**Why**: Agents need to find actual implementation, not just read about it.

---

## Section Types (Use What's Relevant)

### Business Domain Context
```markdown
**Business Logic**: (MOST IMPORTANT for business domains)
- `src/orders/rules/validation-rules.ts` - Order validation business rules

**Implementation**:
- `src/orders/order-processor.ts` - Main order processing logic

**Models/Types**:
- `src/orders/models/order.model.ts` - Order data model

**Tests**:
- `src/orders/__tests__/processor.test.ts` - Order processing tests

**Configuration**:
- `config/orders.config.ts` - Order processing config
```

### Technical/Code Context
```markdown
**Implementation**: (MOST IMPORTANT for technical contexts)
- `src/auth/jwt-handler.ts` - JWT authentication implementation

**Examples**:
- `src/auth/examples/jwt-example.ts` - Working JWT example

**Types**:
- `src/auth/types/jwt-payload.ts` - JWT payload types

**Tests**:
- `src/auth/__tests__/jwt.test.ts` - JWT tests
```

### Standards/Quality Context
```markdown
**Validation/Enforcement**: (MOST IMPORTANT for standards)
- `scripts/validate-code-quality.ts` - Code quality validator
- `eslint.config.js` - ESLint rules

**Examples**:
- `examples/good-code.ts` - Good code example
- `examples/bad-code.ts` - Anti-pattern example

**Tests**:
- `tests/code-quality.test.ts` - Quality validation tests
```

### Operational Context
```markdown
**Scripts/Tools**: (MOST IMPORTANT for operations)
- `scripts/deploy.sh` - Deployment script
- `scripts/monitor.ts` - Monitoring setup

**Configuration**:
- `config/deployment.config.ts` - Deployment configuration
- `.github/workflows/deploy.yml` - CI/CD workflow
```

---

## Rules

<rule id="path_format" enforcement="strict">
  1. Use project-relative paths (src/..., not /Users/...)
  2. Use forward slashes (/)
  3. Include file extension (.ts, .js, .sh)
  4. Brief description (3-10 words) for each file
  5. Verify files exist (warn if not found)
  6. Use relevant sections only (not all files need all sections)
</rule>

---

## Examples

**Business Context**:
```markdown
## 📂 Codebase References

**Business Logic**:
- `src/payments/rules/validation-rules.ts` - Card validation rules
- `src/payments/rules/fraud-detection.ts` - Fraud detection logic

**Implementation**:
- `src/payments/payment-processor.ts` - Main payment processing

**Tests**:
- `src/payments/__tests__/processor.test.ts` - Payment tests
```

**Technical Context**:
```markdown
## 📂 Codebase References

**Implementation**:
- `src/auth/jwt-handler.ts` - JWT authentication

**Examples**:
- `examples/jwt-auth.ts` - Working example

**Tests**:
- `src/auth/__tests__/jwt.test.ts` - JWT tests
```

---

## Validation

- [ ] Has "📂 Codebase References" section?
- [ ] Most important section for context type included?
- [ ] Paths are project-relative?
- [ ] Paths include extensions?
- [ ] Each path has 3-10 word description?

---

## Related

- frontmatter.md - Frontmatter format
- templates.md - File templates
- structure.md - File organization
- templates/ - File templates with codebase references
