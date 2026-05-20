<!-- Context: workflows/external-context-integration | Priority: high | Version: 1.0 | Updated: 2026-01-28 -->
# External Context Integration Guide

## Overview

This guide explains how to integrate external context (fetched via ExternalScout) into the main agent workflow so that subagents can access it without re-fetching.

**Key Principle**: Main agents fetch external docs once → persist to disk → reference in session → subagents read (no re-fetching)

---

## When to Use External Context

Use ExternalScout to fetch external context when:

1. **User asks about external libraries** (Drizzle, Better Auth, Next.js, etc.)
2. **Task involves integration** between multiple external libraries
3. **Setup or configuration** of external tools is needed
4. **API patterns or best practices** from external libraries are relevant

**Don't use** when:
- Question is about internal project code
- Answer is in `/Users/apple/.config/opencode/context/` (use ContextScout instead)
- User is asking for general programming concepts

---

## Integration Workflow

### Stage 1: Analyze & Discover (Before Approval)

```
Main Agent (OpenAgent, etc.)
  ↓
  1. Analyze user request
  ↓
  2. Identify external libraries mentioned
  ↓
  3. Call ContextScout for internal context
  ↓
  4. Call ExternalScout for external docs
     - ExternalScout fetches from Context7 API
     - ExternalScout persists to .tmp/external-context/
     - ExternalScout returns file paths
  ↓
  5. Capture returned file paths
  ↓
  6. Do NOT write anything to disk yet
```

### Stage 2: Propose Plan (Before Approval)

```
Main Agent
  ↓
  1. Show user lightweight summary:
     - What will be done
     - Which external libraries involved
     - Which context files will be used
  ↓
  2. Include discovered external context files in proposal
  ↓
  3. Wait for user approval
```

### Stage 3: Approve (User Gate)

```
User
  ↓
  Approves plan (or redirects)
```

### Stage 4: Init Session (After Approval)

```
Main Agent
  ↓
  1. Create .tmp/sessions/{session-id}/context.md
  ↓
  2. Populate sections:
     - ## Context Files (from ContextScout)
     - ## Reference Files (project files)
     - ## External Context Fetched (from ExternalScout)
     - ## Components
     - ## Constraints
     - ## Exit Criteria
  ↓
  3. CRITICAL: Add "## External Context Fetched" section with:
     - File paths returned by ExternalScout
     - Brief description of each file
     - Note that files are read-only
```

### Stage 5: Delegate with Context Path

```
Main Agent
  ↓
  1. Call TaskManager (or other subagent)
  ↓
  2. Pass session path in prompt:
     "Load context from .tmp/sessions/{session-id}/context.md"
  ↓
  3. TaskManager reads session context
  ↓
  4. TaskManager extracts external context files
  ↓
  5. TaskManager includes in subtask JSONs
```

### Stage 6: Subagents Read External Context

```
TaskManager / CoderAgent / TestEngineer
  ↓
  1. Read session context file
  ↓
  2. Extract "## External Context Fetched" section
  ↓
  3. Read referenced files from .tmp/external-context/
  ↓
  4. Use external docs to inform implementation
  ↓
  5. NO RE-FETCHING ✅
```

---

## Implementation Details

### Step 1: Call ExternalScout

In your main agent (before approval):

```javascript
// Detect external libraries from user request
const externalLibraries = ["drizzle-orm", "better-auth", "next.js"];

// Call ExternalScout
task(
  subagent_type="ExternalScout",
  description="Fetch external documentation",
  prompt="Fetch documentation for these libraries:
          - Drizzle ORM: modular schema organization
          - Better Auth: Next.js integration
          - Next.js: App Router setup
          
          Persist fetched docs to .tmp/external-context/
          Return file paths for each fetched document"
)

// Capture returned file paths
// Example return:
// - .tmp/external-context/drizzle-orm/modular-schemas.md
// - .tmp/external-context/better-auth/nextjs-integration.md
// - .tmp/external-context/next.js/app-router-setup.md
```

### Step 2: Propose Plan with External Context

```markdown
## Implementation Plan

**Task**: Set up Drizzle + Better Auth in Next.js

**External Libraries Involved**:
- Drizzle ORM (database)
- Better Auth (authentication)
- Next.js (framework)

**External Context Discovered**:
- `.tmp/external-context/drizzle-orm/modular-schemas.md`
- `.tmp/external-context/better-auth/nextjs-integration.md`
- `.tmp/external-context/next.js/app-router-setup.md`

**Approach**:
1. Set up Drizzle schema with modular organization
2. Configure Better Auth with Drizzle adapter
3. Integrate with Next.js App Router

**Approval needed before proceeding.**
```

### Step 3: Create Session with External Context

After approval, create `.tmp/sessions/{session-id}/context.md`:

```markdown
# Task Context: Drizzle + Better Auth Integration

Session ID: 2026-01-28-drizzle-auth
Created: 2026-01-28T14:30:22Z
Status: in_progress

## Current Request
Set up Drizzle ORM with Better Auth in a Next.js application

## Context Files (Standards to Follow)
- /Users/apple/.config/opencode/context/core/standards/code-quality.md
- /Users/apple/.config/opencode/context/core/standards/test-coverage.md

## Reference Files (Source Material)
- package.json
- src/db/schema.ts (existing)
- src/auth/config.ts (existing)

## External Context Fetched
These are live documentation files fetched from external libraries. Subagents should reference these instead of re-fetching.

### Drizzle ORM
- `.tmp/external-context/drizzle-orm/modular-schemas.md` — Schema organization patterns for modular architecture
- `.tmp/external-context/drizzle-orm/postgresql-setup.md` — PostgreSQL configuration and setup

### Better Auth
- `.tmp/external-context/better-auth/nextjs-integration.md` — Integration guide for Next.js App Router
- `.tmp/external-context/better-auth/drizzle-adapter.md` — Drizzle adapter setup and configuration

### Next.js
- `.tmp/external-context/next.js/app-router-setup.md` — App Router basics and configuration
- `.tmp/external-context/next.js/server-actions.md` — Server Actions patterns for mutations

**Important**: These files are read-only and cached for reference. Do not modify them.

## Components
- Drizzle schema setup with modular organization
- Better Auth configuration with Drizzle adapter
- Next.js App Router integration

## Constraints
- TypeScript strict mode
- Must support PostgreSQL
- Backward compatible with existing auth system

## Exit Criteria
- [ ] Drizzle schema set up with modular organization
- [ ] Better Auth configured with Drizzle adapter
- [ ] Next.js App Router integration complete
- [ ] All tests passing
- [ ] Documentation updated

## Progress
- [ ] Session initialized
- [ ] Tasks created
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Handoff complete
```

### Step 4: Delegate to TaskManager

```javascript
task(
  subagent_type="TaskManager",
  description="Break down Drizzle + Better Auth integration",
  prompt="Load context from .tmp/sessions/2026-01-28-drizzle-auth/context.md

          Read the context file for full requirements, standards, and external documentation.
          
          Break down this feature into atomic subtasks:
          1. Drizzle schema setup with modular organization
          2. Better Auth configuration with Drizzle adapter
          3. Next.js App Router integration
          4. Test suite
          
          For each subtask, include:
          - context_files: Standards from context.md
          - reference_files: Project files to understand
          - external_context: External docs to reference
          
          Create subtask files in tasks/subtasks/drizzle-auth-integration/"
)
```

### Step 5: TaskManager Creates Subtasks with External Context

TaskManager creates subtask JSONs like:

```json
{
  "id": "01-drizzle-schema-setup",
  "title": "Set up Drizzle schema with modular organization",
  "description": "Create modular Drizzle schema following best practices",
  "context_files": [
    "/Users/apple/.config/opencode/context/core/standards/code-quality.md",
    "/Users/apple/.config/opencode/context/core/standards/test-coverage.md"
  ],
  "reference_files": [
    "package.json",
    "src/db/schema.ts"
  ],
  "external_context": [
    ".tmp/external-context/drizzle-orm/modular-schemas.md",
    ".tmp/external-context/drizzle-orm/postgresql-setup.md"
  ],
  "instructions": "Set up Drizzle schema following modular patterns from external context. Reference .tmp/external-context/drizzle-orm/modular-schemas.md for best practices.",
  "acceptance_criteria": [
    "Schema organized into separate files by domain",
    "PostgreSQL configuration matches external docs",
    "TypeScript types properly exported",
    "Tests cover schema setup"
  ]
}
```

### Step 6: CoderAgent Implements Using External Context

CoderAgent reads subtask JSON and:

1. Loads context_files (standards)
2. Reads reference_files (existing code)
3. **Reads external_context files** (external docs)
4. Implements following all standards and external docs
5. Returns completed subtask

---

## Best Practices

### For Main Agents

✅ **DO**:
- Call ExternalScout early in planning phase
- Capture returned file paths
- Add to session context under "## External Context Fetched"
- Pass session path to subagents
- Include external context in proposal to user

❌ **DON'T**:
- Forget to call ExternalScout when external libraries involved
- Skip adding external context to session
- Re-fetch external docs (trust ExternalScout persistence)
- Modify external context files

### For ExternalScout

✅ **DO**:
- Always persist fetched docs to `.tmp/external-context/`
- Update `.manifest.json` after each fetch
- Include metadata header in every file
- Filter aggressively to relevant sections
- Cite sources and include official docs links

❌ **DON'T**:
- Forget to persist files
- Skip manifest updates
- Return entire documentation
- Fabricate documentation content
- Write outside `.tmp/external-context/`

### For TaskManager

✅ **DO**:
- Extract external_context from session context
- Include in subtask JSONs
- Pass to downstream agents
- Document which external docs informed decisions

❌ **DON'T**:
- Forget to include external_context in subtasks
- Mix external_context with context_files
- Assume subagents will re-fetch

### For Subagents (CoderAgent, TestEngineer, etc.)

✅ **DO**:
- Read external_context files from subtask JSON
- Use external docs to inform implementation
- Reference external docs in comments
- Follow patterns from external docs

❌ **DON'T**:
- Re-fetch external documentation
- Ignore external context files
- Modify external context files
- Assume external docs are optional

---

## Example: Complete Flow

### User Request
```
"Set up Drizzle ORM with Better Auth in Next.js, using modular schema organization"
```

### Main Agent Flow

1. **Analyze**: Detect Drizzle, Better Auth, Next.js
2. **Discover**: Call ContextScout + ExternalScout
3. **Propose**: Show plan with external context files
4. **Approve**: User approves
5. **Init Session**: Create context.md with external context section
6. **Delegate**: Call TaskManager with session path
7. **Validate**: Check tests pass
8. **Complete**: Update docs, cleanup

### ExternalScout Flow

1. **Detect**: Drizzle, Better Auth, Next.js
2. **Fetch**: Get docs from Context7 API
3. **Filter**: Extract relevant sections
4. **Persist**: Write to `.tmp/external-context/{package}/{topic}.md`
5. **Update**: Add to `.manifest.json`
6. **Return**: File paths to main agent

### TaskManager Flow

1. **Read**: Session context.md
2. **Extract**: External context files
3. **Create**: Subtasks with external_context field
4. **Delegate**: Pass to CoderAgent

### CoderAgent Flow

1. **Read**: Subtask JSON
2. **Load**: context_files (standards)
3. **Reference**: reference_files (existing code)
4. **Read**: external_context files (external docs)
5. **Implement**: Following all standards and external docs
6. **Complete**: Return implemented subtask

---

## Troubleshooting

### External Context Files Not Found

**Problem**: Subagent can't find `.tmp/external-context/{package}/{topic}.md`

**Solution**:
1. Check ExternalScout ran successfully
2. Verify file path in session context matches actual location
3. Check `.manifest.json` to see what's cached
4. If missing, re-run ExternalScout

### Stale External Context

**Problem**: External docs are outdated

**Solution**:
1. Delete stale files: `scripts/external-context/manage-external-context.sh delete-package {package}`
2. Re-run ExternalScout to fetch fresh docs
3. Update session context with new file paths

### Manifest Out of Sync

**Problem**: `.manifest.json` doesn't match actual files

**Solution**:
1. Regenerate manifest: `scripts/external-context/manage-external-context.sh regenerate-manifest`
2. Verify all files have metadata headers

---

## References

- **ExternalScout**: `.opencode/agent/subagents/core/externalscout.md`
- **External Context Management**: `/Users/apple/.config/opencode/context/core/workflows/external-context-management.md`
- **Task Delegation**: `/Users/apple/.config/opencode/context/core/workflows/task-delegation-basics.md`
- **Management Script**: `scripts/external-context/manage-external-context.sh`
