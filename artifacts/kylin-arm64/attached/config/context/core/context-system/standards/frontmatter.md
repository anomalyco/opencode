# Frontmatter Format

**Purpose**: HTML comment frontmatter format for all context files

**Last Updated**: 2026-01-27

---

## Format

<rule id="frontmatter_required" enforcement="strict">
  ALL context files MUST start with:
  
  ```markdown
  <!-- Context: {category}/{function} | Priority: {level} | Version: X.Y | Updated: YYYY-MM-DD -->
  ```
</rule>

---

## Components

**Category/Function**: `{category}/{function}`
- Examples: `ecommerce/concepts`, `development/examples`, `core/standards`
- Category = domain (ecommerce, payments, development)
- Function = file type (concepts, examples, guides, lookup, errors)

**Priority**: `critical` | `high` | `medium` | `low`
- critical: 80% of use cases (business logic, core concepts)
- high: 15% of use cases (common workflows, examples)
- medium: 4% of use cases (edge cases)
- low: 1% of use cases (rare scenarios)

**Version**: `X.Y` (start 1.0, increment on changes)

**Updated**: `YYYY-MM-DD` (ISO 8601, must match metadata section)

---

## Examples

```markdown
<!-- Context: ecommerce/concepts | Priority: critical | Version: 1.0 | Updated: 2026-01-27 -->
<!-- Context: payments/guides | Priority: high | Version: 1.2 | Updated: 2026-01-27 -->
<!-- Context: development/examples | Priority: medium | Version: 1.0 | Updated: 2026-01-27 -->
```

---

## Validation

- [ ] Frontmatter is first line?
- [ ] Format exact: `<!-- Context: ... -->`?
- [ ] Priority is critical|high|medium|low?
- [ ] Version is X.Y?
- [ ] Date is YYYY-MM-DD?

---

## Related

- structure.md - File organization
- templates.md - File templates
- codebase-references.md - Linking to code
