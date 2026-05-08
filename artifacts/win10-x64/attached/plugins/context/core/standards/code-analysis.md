<!-- Context: standards/analysis | Priority: high | Version: 2.0 | Updated: 2025-01-21 -->

# Analysis Guidelines

## Quick Reference

**Process**: Context → Gather → Patterns → Impact → Recommendations

**Report Format**: Context, Findings, Patterns, Issues (🔴🟡🔵), Recommendations, Trade-offs, Next Steps

**Be**: Thorough, Objective, Specific, Actionable

**Checklist**: Context stated, Evidence gathered, Patterns identified, Issues prioritized, Recommendations specific, Trade-offs considered

---

## Purpose
Framework for analyzing code, patterns, and technical issues systematically.

## When to Use
Reference this when:
- Analyzing codebase patterns
- Investigating bugs or issues
- Evaluating architectural decisions
- Assessing code quality
- Researching solutions

## Analysis Process

### 1. Understand Context
- What are we analyzing and why?
- What's the goal or question?
- What's the scope?
- What constraints exist?

### 2. Gather Information
- Read relevant code / data points
- Check documentation
- Search for patterns
- Review related issues
- Examine dependencies

### 3. Identify Patterns
- What's consistent across the codebase?
- What conventions are followed?
- What patterns are repeated?
- What's inconsistent or unusual?

### 4. Assess Impact
- What are the implications?
- What are the trade-offs?
- What could break?
- What are the risks?

### 5. Provide Recommendations
- What should be done?
- Why this approach?
- What are alternatives?
- What's the priority?

## Analysis Report Format

```markdown
## Analysis: {Topic}

**Context:** {What we're analyzing and why}

**Findings:**
- {Key finding 1}
- {Key finding 2}
- {Key finding 3}

**Patterns Observed:**
- {Pattern 1}: {Description}
- {Pattern 2}: {Description}

**Issues Identified:**
- 🔴 Critical: {Issue requiring immediate attention}
- 🟡 Warning: {Issue to address soon}
- 🔵 Suggestion: {Nice-to-have improvement}

**Recommendations:**
1. {Recommendation 1} - {Why}
2. {Recommendation 2} - {Why}

**Trade-offs:**
- {Approach A}: {Pros/Cons}
- {Approach B}: {Pros/Cons}

**Next Steps:**
- {Action 1}
- {Action 2}
```

## Common Analysis Types

### Code Quality Analysis
- Complexity (cyclomatic, cognitive)
- Duplication
- Test coverage
- Documentation completeness
- Naming consistency
- Error handling patterns

### Architecture Analysis
- Module dependencies
- Coupling and cohesion
- Separation of concerns
- Scalability considerations
- Performance bottlenecks

### Bug Investigation
- Reproduce the issue
- Identify root cause
- Assess impact and severity
- Propose fix with rationale
- Consider edge cases

### Pattern Discovery
- Search for similar implementations
- Identify common approaches
- Document conventions
- Note inconsistencies
- Recommend standardization

## Best Practices

### Be Thorough
- Check multiple examples
- Consider edge cases
- Look for exceptions
- Verify assumptions

### Be Objective
- Base conclusions on evidence
- Avoid assumptions
- Consider multiple perspectives
- Acknowledge limitations

### Be Specific
- Provide concrete examples
- Include file names and line numbers
- Show code snippets
- Quantify when possible

### Be Actionable
- Clear recommendations
- Prioritize findings
- Explain rationale
- Suggest next steps


