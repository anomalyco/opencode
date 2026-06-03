<!-- Context: workflows/review | Priority: high | Version: 2.0 | Updated: 2025-01-21 -->

# Code Review Guidelines

## Quick Reference

**Golden Rule**: Review code as you'd want yours reviewed - thoroughly but kindly

**Checklist**: Functionality, Code Quality, Security, Testing, Performance, Maintainability

**Report Format**: Summary, Assessment, Issues (🔴🟡🔵), Positive Observations, Recommendations

**Principles**: Constructive, Thorough, Timely

---

## Principles

**Constructive**: Focus on code not person, explain WHY, suggest improvements, acknowledge good practices
**Thorough**: Check functionality not just style, consider edge cases, think maintainability, look for security
**Timely**: Review promptly, don't block unnecessarily, prioritize critical issues

## Review Checklist

### Functionality
- [ ] Does what it's supposed to do
- [ ] Edge cases handled
- [ ] Error cases handled
- [ ] No obvious bugs

### Code Quality
- [ ] Clear, descriptive naming
- [ ] Functions small and focused
- [ ] No unnecessary complexity
- [ ] Follows coding standards
- [ ] DRY - no duplication

### Security
- [ ] Input validation present
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] No hardcoded secrets
- [ ] Sensitive data handled properly
- [ ] Auth/authorization appropriate

### Testing
- [ ] Tests present
- [ ] Happy path covered
- [ ] Edge cases covered
- [ ] Error cases covered
- [ ] All tests pass

### Performance
- [ ] No obvious performance issues
- [ ] Efficient algorithms
- [ ] No unnecessary operations
- [ ] Resources properly managed

### Maintainability
- [ ] Easy to understand
- [ ] Complex logic documented
- [ ] Follows project conventions
- [ ] Easy to modify/extend

## Review Report Format

```markdown
## Code Review: {Feature/PR Name}

**Summary:** {Brief overview}
**Assessment:** Approve / Needs Work / Requires Changes

---

### Issues Found

#### 🔴 Critical (Must Fix)
- **File:** `src/auth.js:42`
  **Issue:** Password stored in plain text
  **Fix:** Hash password before storing

#### 🟡 Warnings (Should Fix)
- **File:** `src/user.js:15`
  **Issue:** No input validation
  **Fix:** Validate email format

#### 🔵 Suggestions (Nice to Have)
- **File:** `src/utils.js:28`
  **Issue:** Could be more concise
  **Fix:** Use array methods instead of loop

---

### Positive Observations
- ✅ Good test coverage (95%)
- ✅ Clear function names
- ✅ Proper error handling

---

### Recommendations
{Next steps, improvements, follow-up items}
```

## Common Issues

### Security
🔴 Hardcoded credentials
🔴 SQL injection vulnerabilities
🔴 Missing input validation
🔴 Exposed sensitive data

### Code Quality
🟡 Large functions (>50 lines)
🟡 Deep nesting (>3 levels)
🟡 Code duplication
🟡 Unclear naming

### Testing
🟡 Missing tests
🟡 Low coverage (<80%)
🟡 Flaky tests
🟡 Tests testing implementation

## Best Practices

✅ Review within 24 hours
✅ Provide specific, actionable feedback
✅ Explain WHY, not just WHAT
✅ Suggest alternatives
✅ Acknowledge good work
✅ Use severity levels (Critical/Warning/Suggestion)
✅ Test the code if possible
✅ Check for security issues first

**Golden Rule**: Review code as you'd want yours reviewed - thoroughly but kindly.
