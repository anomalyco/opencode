<!-- Context: core/context-guide | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Context System Guide

## Quick Reference

**Golden Rule**: Fetch context when needed, not before (lazy loading)

**Key Principle**: Use context index for discovery, load specific files as needed

**Index Location**: `/Users/apple/.config/opencode/context/navigation.md` - Quick map of all contexts

**Structure**: standards/ (quality + analysis), workflows/ (process + review), system/ (internals)

**Session Location**: `.tmp/sessions/{timestamp}-{task-slug}/context.md`

---

## Overview

Context files provide guidelines and templates for specific tasks. Use the index system for efficient discovery and lazy loading to keep prompts lean.

## Context Index System

**Central Index**: `/Users/apple/.config/opencode/context/navigation.md` - Ultra-compact map of all contexts

The index provides:
- Quick map for common tasks (code, docs, tests, review, delegation)
- Triggers/keywords for each context
- Dependencies between contexts
- Priority levels (critical, high, medium)

### Available Context Files

All files are in `/Users/apple/.config/opencode/context/core/` with organized subfolders:

### Standards (Quality Guidelines + Analysis)
- `standards/code-quality.md` - Modular, functional code principles [critical]
- `standards/documentation.md` - Documentation standards [critical]
- `standards/test-coverage.md` - Testing standards [critical]
- `standards/security-patterns.md` - Core patterns (error handling, security) [high]
- `standards/code-analysis.md` - Analysis framework [high]

### Workflows (Process Templates + Review)
- `workflows/task-delegation-basics.md` - Delegation template [high]
- `workflows/feature-breakdown.md` - Complex task breakdown [high]
- `workflows/session-management.md` - Session lifecycle [medium]
- `workflows/code-review.md` - Code review guidelines [high]

## How to Use the Index

**Step 1: Check Quick Map** (for common tasks)
- Code task? → Load `standards/code-quality.md`
- Docs task? → Load `standards/documentation.md`
- Review task? → Load `workflows/code-review.md`

**Step 2: Load Index** (for keyword matching)
- Load `/Users/apple/.config/opencode/context/navigation.md`
- Scan triggers to find relevant contexts
- Load specific context files as needed

**Step 3: Load Dependencies**
- Check `deps:` in index
- Load dependent contexts for complete guidelines

**Benefits:**
- No prompt bloat (index is only ~120 tokens)
- Fetch only what's relevant
- Faster for simple tasks
- Clear dependency tracking

## When to Use Each File

### /Users/apple/.config/opencode/context/core/standards/code-quality.md
- Writing new code
- Modifying existing code
- Following modular/functional patterns
- Making architectural decisions

### /Users/apple/.config/opencode/context/core/standards/documentation.md
- Writing README files
- Creating API documentation
- Adding code comments

### /Users/apple/.config/opencode/context/core/standards/test-coverage.md
- Writing new tests
- Running test suites
- Debugging test failures

### /Users/apple/.config/opencode/context/core/standards/security-patterns.md
- Error handling
- Security patterns
- Common code patterns

### /Users/apple/.config/opencode/context/core/standards/code-analysis.md
- Analyzing codebase patterns
- Investigating bugs
- Evaluating architecture

### /Users/apple/.config/opencode/context/core/workflows/task-delegation-basics.md
- Delegating to general agent
- Creating task context
- Multi-file coordination

### /Users/apple/.config/opencode/context/core/workflows/feature-breakdown.md
- Tasks with 4+ files
- Estimated effort >60 minutes
- Complex dependencies

### /Users/apple/.config/opencode/context/core/workflows/session-management.md
- Session lifecycle
- Cleanup procedures
- Session isolation

### /Users/apple/.config/opencode/context/core/workflows/code-review.md
- Reviewing code
- Conducting code audits
- Providing PR feedback

## Temporary Context (Session-Specific)

When delegating, create focused task context:

**Location**: `.tmp/sessions/{timestamp}-{task-slug}/context.md`

**Structure**:
```markdown
# Task Context: {Task Name}

Session ID: {id}
Created: {timestamp}
Status: in_progress

## Current Request
{What user asked for}

## Requirements
- {requirement 1}
- {requirement 2}

## Decisions Made
- {decision 1}

## Files to Modify/Create
- {file 1} - {purpose}

## Static Context Available
- /Users/apple/.config/opencode/context/core/standards/code-quality.md
- /Users/apple/.config/opencode/context/core/standards/test-coverage.md

## Constraints/Notes
{Important context}

## Progress
- [ ] {task 1}
- [ ] {task 2}

---
**Instructions for Subagent:**
{Specific instructions}
```

## Session Management

### Session Structure
```
.tmp/sessions/{session-id}/
├── context.md          # Task context
├── notes.md            # Working notes
└── artifacts/          # Generated files
```

### Session ID Format
`{timestamp}-{random-4-chars}`
Example: `20250119-143022-a4f2`

### Cleanup
- Ask user before deleting session files
- Remove after task completion
- Keep if user wants to review

## Best Practices

✅ Use index for context discovery
✅ Load only relevant context files
✅ Check dependencies in index
✅ Create temp context when delegating
✅ Clean up sessions after completion
✅ Reference specific sections when possible
✅ Keep temp context focused and concise

**Golden Rule**: Fetch context when needed, not before.
