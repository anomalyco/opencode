# Thinking Flows for Electron + React + SQLite Projects

> **Purpose**: Systematic thinking guides to catch issues before they become bugs.
>
> **Core Philosophy**: 30 minutes of thinking saves 3 hours of debugging.

---

## Why Thinking Flows?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries -> cross-layer bugs
- Didn't think about code patterns repeating -> duplicated code everywhere
- Didn't think about edge cases -> runtime errors
- Didn't think about future maintainers -> unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Thinking Guides

| Guide                                                             | Purpose                                                      | When to Use                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| [Cross-Layer Thinking](./cross-layer-thinking-guide.md)           | Think through data flow across layers                        | Before implementing features that span 3+ layers     |
| [Pre-Implementation Checklist](./pre-implementation-checklist.md) | Verify readiness before coding                               | Before starting any feature implementation           |
| [Bug Root Cause Analysis](./bug-root-cause-thinking-guide.md)     | Analyze bugs to understand preventability                    | After fixing any non-trivial bug                     |
| [Code Reuse Thinking](./code-reuse-thinking-guide.md)             | Identify patterns and reduce duplication                     | When you notice repeated code patterns               |
| [DB Schema Change](./db-schema-change-guide.md)                   | Ensure schema changes are fully deployed                     | When modifying database schema                       |
| [Semantic Change Checklist](./semantic-change-checklist.md)       | Ensure all code is updated when changing data interpretation | When changing how the system interprets a field/type |
| [Transaction Consistency](./transaction-consistency-guide.md)     | Ensure data consistency across write paths                   | When implementing multi-table writes                 |

---

## Quick Reference: When to Use Which Guide

### Cross-Layer Issues

Use [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) when:

- [ ] Feature touches 3+ layers (Main Process, Renderer, IPC, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic
- [ ] Integrates with external systems

### Before Writing Code

Use [Pre-Implementation Checklist](./pre-implementation-checklist.md) when:

- [ ] About to add a constant or config value
- [ ] About to implement new logic
- [ ] About to define a type
- [ ] About to create a component
- [ ] Feels like you've seen similar code before

### After Fixing Bugs

Use [Bug Root Cause Analysis](./bug-root-cause-thinking-guide.md) when:

- [ ] Just fixed a bug that took >30 minutes to debug
- [ ] Bug involved unexpected library behavior
- [ ] Bug involved assumptions about function behavior
- [ ] Similar bugs have occurred before

### Code Organization

Use [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) when:

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're creating a new utility/helper function** (search first!)

### Database Changes

Use [DB Schema Change Guide](./db-schema-change-guide.md) when:

- [ ] Modifying database schema
- [ ] Changing column types
- [ ] Adding/removing columns
- [ ] Deployed code expects different data format than DB has

### Semantic Changes

Use [Semantic Change Checklist](./semantic-change-checklist.md) when:

- [ ] Changing what a field value **means** (not just adding new values)
- [ ] Changing timestamp units (seconds vs milliseconds)
- [ ] Removing or redefining enum values
- [ ] Changing how null/undefined/default is interpreted

### Data Consistency

Use [Transaction Consistency Guide](./transaction-consistency-guide.md) when:

- [ ] Implementing writes that touch multiple tables
- [ ] Data appears in database but not in UI
- [ ] Building event-sourced or CQRS patterns

---

## The Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
rg "value_to_change" --type ts

# Check how many files define this value
rg "CONFIG_NAME" --type ts -c
```

This single habit prevents most "forgot to update X" bugs.

---

## Electron-Specific Layers

In Electron + React + SQLite projects, these are the typical layers:

```
UI Layer (React Components)
        |
        v
State Layer (React Hooks, Context, Store)
        |
        v
IPC Layer (preload scripts, contextBridge)
        |
        v
Main Process (Electron main, handlers)
        |
        v
Database Layer (SQLite, ORM like Drizzle/Prisma)
```

Each boundary is a potential source of bugs due to:

- **Type mismatches** - Types may not match across IPC
- **Format differences** - Dates, IDs, nulls handled differently
- **Async timing** - IPC is async, state updates are async
- **Serialization** - Only serializable data crosses IPC boundary

---

## Core Principles

1. **Search Before Write** - Always search for existing patterns before creating new ones
2. **Think Before Code** - 5 minutes of checklist saves 50 minutes of debugging
3. **Document Assumptions** - Make implicit assumptions explicit
4. **Verify All Layers** - Changes often need updates in multiple places
5. **Learn From Bugs** - Add lessons to these guides after fixing non-trivial bugs

---

## Contributing

Found a new "didn't think of that" moment? Add it:

1. If it's a **general thinking pattern** -> Add to existing guide or create new one
2. If it caused a bug -> Add to "Lessons Learned" section in the relevant guide
3. If it's **project-specific** -> Create a separate project-specific guide

---

**Language**: All documentation should be written in **English**.
