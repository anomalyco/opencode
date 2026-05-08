<!-- Context: standards/intelligence | Priority: high | Version: 1.0 | Updated: 2025-01-12 -->

# Project Intelligence

> **What**: Living documentation that bridges business domain and technical implementation.
> **Why**: Quick project understanding and onboarding for developers, agents, and stakeholders.
> **Where**: `/Users/apple/.config/opencode/context/project-intelligence/` (dedicated folder)

## Quick Reference

| What You Need | File | Description |
|---------------|------|-------------|
| Understand the "why" | `business-domain.md` | Problem, users, value |
| Understand the "how" | `technical-domain.md` | Stack, architecture |
| See the connection | `business-tech-bridge.md` | Business → technical mapping |
| Know the context | `decisions-log.md` | Why decisions were made |
| Current state | `living-notes.md` | Active issues, debt, questions |

## Why This Exists

Projects fail when:
- Business intent is lost in code
- Technical decisions aren't documented with context
- New members spend weeks instead of hours understanding the project
- Context lives only in people's heads (who leave)

This ensures **business and technical domains speak the same language**.

## Structure

```
/Users/apple/.config/opencode/context/
├── project-intelligence/              # Project-specific context
│   ├── navigation.md                  # Quick overview & routes
│   ├── business-domain.md             # Business context, problems solved
│   ├── technical-domain.md            # Stack, architecture, decisions
│   ├── business-tech-bridge.md        # How business needs → solutions
│   ├── decisions-log.md               # Decisions with rationale
│   └── living-notes.md                # Active issues, technical debt
└── core/                              # Universal standards
```

## Onboarding Checklist

For new team members or agents:

- [ ] Read `navigation.md` (this file)
- [ ] Read `business-domain.md` to understand the "why"
- [ ] Read `technical-domain.md` to understand the "how"
- [ ] Review `business-tech-bridge.md` to see the connection
- [ ] Check `decisions-log.md` for context on key choices
- [ ] Review `living-notes.md` for current state
- [ ] Explore codebase with this context loaded

## How to Keep This Alive

| Trigger | Action |
|---------|--------|
| Business direction shifts | Update `business-domain.md` |
| New technical decision | Add to `decisions-log.md` |
| New issues or debt | Update `living-notes.md` |
| Feature launch | Update `business-tech-bridge.md` |
| Stack changes | Update `technical-domain.md` |

**Full Management Guide**: See `/Users/apple/.config/opencode/context/core/standards/project-intelligence-management.md`

## Integration with Context System

- **Lazy Loading**: Load project intelligence first when joining a project
- **Layering**: Then load standards and specific context as needed
- **Reference**: See `/Users/apple/.config/opencode/context/core/context-system.md` for system overview

## Related Files

- **Management Guide**: `/Users/apple/.config/opencode/context/core/standards/project-intelligence-management.md`
- **Context System**: `/Users/apple/.config/opencode/context/core/context-system.md`
- **Standards Index**: `/Users/apple/.config/opencode/context/core/standards/navigation.md`
