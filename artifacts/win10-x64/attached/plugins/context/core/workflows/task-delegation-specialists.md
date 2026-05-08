<!-- Context: workflows/delegation-specialists | Priority: high | Version: 1.0 | Updated: 2026-02-05 -->
# When to Delegate to Specialists

**Purpose**: Guidance on when to delegate to specific specialist agents

---

## OpenFrontendSpecialist - UI/UX Design

**✅ DELEGATE when:**
- Creating new UI/UX designs (landing pages, dashboards)
- Building design systems (components, themes, style guides)
- Complex layouts requiring responsive design
- Visual polish (animations, transitions, micro-interactions)
- Brand-focused pages (marketing, product showcases)
- Accessibility-critical UI

**Delegation pattern:**
```javascript
task(
  subagent_type="OpenFrontendSpecialist",
  description="Design {feature} UI",
  prompt="Load context from .tmp/sessions/{session-id}/context.md
  
  Design {feature} following 4-stage workflow:
  1. Stage 0: Create design plan file (MANDATORY FIRST)
  2. Stage 1: Layout (ASCII wireframe)
  3. Stage 2: Theme (design system, colors)
  4. Stage 3: Animation (micro-interactions)
  5. Stage 4: Implementation (single HTML file)
  
  Request approval between stages."
)
```

**Why?** Follows structured 4-stage workflow with approval gates, produces polished UI.

---

## TestEngineer - Test Authoring

**✅ DELEGATE when:**
- Writing comprehensive test suites
- TDD workflows (tests before implementation)
- Complex test scenarios (edge cases, error handling)
- Integration tests across multiple components

**Delegation pattern:**
```javascript
task(
  subagent_type="TestEngineer",
  description="Write tests for {feature}",
  prompt="Load context from .tmp/sessions/{session-id}/context.md
  
  Write comprehensive tests for {feature}
  Files to test: {file list}
  Follow test coverage standards from context."
)
```

---

## CodeReviewer - Quality Assurance

**✅ DELEGATE when:**
- Reviewing complex implementations
- Security-critical code review
- Pre-merge quality checks
- Architecture validation

**Delegation pattern:**
```javascript
task(
  subagent_type="CodeReviewer",
  description="Review {feature}",
  prompt="Load context from .tmp/sessions/{session-id}/context.md
  
  Review {feature} against standards
  Files: {file list}
  Focus: security, performance, maintainability"
)
```

---

## CoderAgent - Focused Implementation

**✅ DELEGATE when:**
- Implementing atomic subtasks from TaskManager
- Isolated feature work (single component/module)
- Following specific implementation specs

**Delegation pattern:**
```javascript
task(
  subagent_type="CoderAgent",
  description="Implement {subtask}",
  prompt="Load context from .tmp/sessions/{session-id}/context.md
  
  Implement subtask: {description}
  Follow implementation spec exactly.
  Mark subtask complete when done."
)
```

---

## Decision Matrix

| Scenario | Agent | Why |
|----------|-------|-----|
| New landing page | OpenFrontendSpecialist | 4-stage design workflow |
| Test suite for auth | TestEngineer | Comprehensive coverage |
| Security review | CodeReviewer | Security focus |
| Single API endpoint | CoderAgent | Focused implementation |
| Complex multi-file feature | TaskManager → CoderAgent | Breakdown then implement |

---

## Key Principle

**TestEngineer and CodeReviewer should ALWAYS receive session context path.** This ensures they review against the same standards used during implementation.

---

## Related

- `task-delegation-basics.md` - Core delegation workflow
- `task-delegation-caching.md` - Context caching
- `design-iteration-overview.md` - OpenFrontendSpecialist workflow
