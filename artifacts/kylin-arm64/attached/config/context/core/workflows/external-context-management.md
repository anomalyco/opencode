<!-- Context: workflows/external-context | Priority: high | Version: 1.0 | Updated: 2026-01-28 -->
# External Context Management

## Overview

External context is live documentation fetched from external libraries and frameworks (via Context7 API or official docs). Instead of re-fetching on every task, we **persist external context** to `.tmp/external-context/` so main agents can pass it to subagents.

**Key Principle**: ExternalScout fetches once → persists to disk → main agents reference → subagents read (no re-fetching)

---

## Directory Structure

```
.tmp/external-context/
├── .manifest.json                    # Metadata about all cached external docs
├── drizzle-orm/
│   ├── modular-schemas.md           # Fetched: "How to organize schemas modularly"
│   ├── postgresql-setup.md          # Fetched: "PostgreSQL setup with Drizzle"
│   └── typescript-config.md         # Fetched: "TypeScript configuration"
├── better-auth/
│   ├── nextjs-integration.md        # Fetched: "Better Auth + Next.js setup"
│   ├── drizzle-adapter.md           # Fetched: "Drizzle adapter for Better Auth"
│   └── session-management.md        # Fetched: "Session handling"
├── next.js/
│   ├── app-router-setup.md          # Fetched: "App Router basics"
│   ├── server-actions.md            # Fetched: "Server Actions patterns"
│   └── middleware.md                # Fetched: "Middleware configuration"
└── tanstack-query/
    ├── server-components.md         # Fetched: "TanStack Query + Server Components"
    └── prefetching.md               # Fetched: "Prefetching strategies"
```

### Naming Conventions

- **Package name** (directory): Exact npm package name (kebab-case)
  - ✅ `drizzle-orm`, `better-auth`, `next.js`, `@tanstack/react-query`
  - ❌ `drizzle`, `nextjs`, `tanstack-query`

- **File name** (topic): Kebab-case description of the topic
  - ✅ `modular-schemas.md`, `nextjs-integration.md`, `server-components.md`
  - ❌ `modular schemas.md`, `NextJS Integration.md`, `ServerComponents.md`

---

## Manifest File

**Location**: `.tmp/external-context/.manifest.json`

**Purpose**: Track what's cached, when it was fetched, and from which source

**Structure**:
```json
{
  "last_updated": "2026-01-28T14:30:22Z",
  "packages": {
    "drizzle-orm": {
      "files": [
        "modular-schemas.md",
        "postgresql-setup.md",
        "typescript-config.md"
      ],
      "last_updated": "2026-01-28T14:30:22Z",
      "source": "Context7 API",
      "official_docs": "https://orm.drizzle.team"
    },
    "better-auth": {
      "files": [
        "nextjs-integration.md",
        "drizzle-adapter.md",
        "session-management.md"
      ],
      "last_updated": "2026-01-28T14:25:10Z",
      "source": "Context7 API",
      "official_docs": "https://better-auth.com"
    },
    "next.js": {
      "files": [
        "app-router-setup.md",
        "server-actions.md",
        "middleware.md"
      ],
      "last_updated": "2026-01-28T14:20:05Z",
      "source": "Context7 API",
      "official_docs": "https://nextjs.org"
    }
  }
}
```

---

## File Format

Each external context file has a metadata header followed by the documentation content.

**Template**:
```markdown
---
source: Context7 API
library: Drizzle ORM
package: drizzle-orm
topic: modular-schemas
fetched: 2026-01-28T14:30:22Z
official_docs: https://orm.drizzle.team/docs/goodies#multi-file-schemas
---

# Modular Schemas in Drizzle ORM

[Filtered documentation content from Context7 API]

## Key Concepts

[Relevant sections only]

## Code Examples

[Practical examples from official docs]

---

**Source**: Context7 API (live, version-specific)
**Official Docs**: https://orm.drizzle.team/docs/goodies#multi-file-schemas
**Fetched**: 2026-01-28T14:30:22Z
```

---

## Workflow: How External Context Flows

### Stage 1: Main Agent Needs External Context

```
Main Agent (e.g., OpenAgent)
  ↓
  Detects: "User is asking about Drizzle + Better Auth + Next.js"
  ↓
  Calls: ExternalScout to fetch live docs
```

### Stage 2: ExternalScout Fetches & Persists

```
ExternalScout
  ↓
  1. Detects libraries: Drizzle, Better Auth, Next.js
  ↓
  2. Fetches from Context7 API (primary) or official docs (fallback)
  ↓
  3. Filters to relevant sections
  ↓
  4. Persists to .tmp/external-context/{package-name}/{topic}.md
  ↓
  5. Updates .manifest.json
  ↓
  Returns: File paths + formatted documentation
```

### Stage 3: Main Agent References in Session Context

```
Main Agent
  ↓
  Creates session: .tmp/sessions/{session-id}/context.md
  ↓
  Adds section: "## External Context Fetched"
  ↓
  Lists files:
    - .tmp/external-context/drizzle-orm/modular-schemas.md
    - .tmp/external-context/better-auth/nextjs-integration.md
    - .tmp/external-context/next.js/app-router-setup.md
  ↓
  Delegates to TaskManager with session path
```

### Stage 4: Subagents Read External Context

```
TaskManager (or CoderAgent, TestEngineer, etc.)
  ↓
  Reads: .tmp/sessions/{session-id}/context.md
  ↓
  Extracts: "## External Context Fetched" section
  ↓
  Reads: .tmp/external-context/{package-name}/{topic}.md files
  ↓
  Uses: External docs to inform implementation
  ↓
  NO RE-FETCHING needed ✅
```

---

## Integration with Task Delegation

### In Session Context File

Add this section to `.tmp/sessions/{session-id}/context.md`:

```markdown
## External Context Fetched

These are live documentation files fetched from external libraries. Subagents should reference these instead of re-fetching.

### Drizzle ORM
- `.tmp/external-context/drizzle-orm/modular-schemas.md` — Schema organization patterns
- `.tmp/external-context/drizzle-orm/postgresql-setup.md` — PostgreSQL configuration

### Better Auth
- `.tmp/external-context/better-auth/nextjs-integration.md` — Next.js integration guide
- `.tmp/external-context/better-auth/drizzle-adapter.md` — Drizzle adapter setup

### Next.js
- `.tmp/external-context/next.js/app-router-setup.md` — App Router basics
- `.tmp/external-context/next.js/server-actions.md` — Server Actions patterns

**Important**: These files are read-only and should not be modified. They're cached for reference only.
```

### In Subtask JSONs (Created by TaskManager)

When TaskManager creates subtask JSONs, it should include external context files:

```json
{
  "id": "01-drizzle-schema-setup",
  "title": "Set up Drizzle schema with modular organization",
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
  "instructions": "Set up Drizzle schema following modular patterns from external context..."
}
```

---

## Cleanup & Maintenance

### When to Clean Up

External context files should be cleaned up when:
1. Task is complete and session is deleted
2. External docs become stale (>7 days old)
3. User explicitly requests cleanup
4. Disk space is needed

### How to Clean Up

**Manual cleanup** (ask user first):
```bash
rm -rf .tmp/external-context/{package-name}/
# Update .manifest.json to remove package entry
```

**Automatic cleanup** (future enhancement):
- Add cleanup script that removes files older than 7 days
- Run as part of session cleanup process
- Update manifest after cleanup

### Manifest Cleanup

After deleting external context files, update `.manifest.json`:
```json
{
  "last_updated": "2026-01-28T15:00:00Z",
  "packages": {
    // Remove entries for deleted packages
  }
}
```

---

## Best Practices

### For Main Agents (OpenAgent, etc.)

1. **Call ExternalScout early** in the planning phase
2. **Capture returned file paths** from ExternalScout
3. **Add to session context** in "## External Context Fetched" section
4. **Pass session path to subagents** so they know where to find external docs
5. **Don't re-fetch** — trust that ExternalScout persisted correctly

### For ExternalScout

1. **Always persist** fetched documentation to `.tmp/external-context/`
2. **Update manifest** after each fetch
3. **Include metadata header** in every file (source, library, package, topic, fetched timestamp)
4. **Filter aggressively** — only include relevant sections
5. **Cite sources** — include official docs links

### For Subagents (TaskManager, CoderAgent, etc.)

1. **Read external context files** from session context
2. **Don't re-fetch** — use persisted files
3. **Reference in implementation** — cite which external docs informed decisions
4. **Don't modify** external context files — they're read-only
5. **Include in subtask JSONs** — pass external_context to downstream agents

---

## Examples

### Example 1: Drizzle + Better Auth Integration

**Main Agent Flow**:
```
1. User asks: "Set up Drizzle + Better Auth in Next.js"
2. Main agent calls ExternalScout
3. ExternalScout fetches:
   - drizzle-orm/modular-schemas.md
   - drizzle-orm/postgresql-setup.md
   - better-auth/nextjs-integration.md
   - better-auth/drizzle-adapter.md
   - next.js/app-router-setup.md
4. ExternalScout persists all files to .tmp/external-context/
5. Main agent creates session with "## External Context Fetched" section
6. Main agent delegates to TaskManager with session path
7. TaskManager reads external context, creates subtasks
8. CoderAgent implements using external docs (no re-fetching)
```

**Session Context File**:
```markdown
## External Context Fetched

### Drizzle ORM
- `.tmp/external-context/drizzle-orm/modular-schemas.md`
- `.tmp/external-context/drizzle-orm/postgresql-setup.md`

### Better Auth
- `.tmp/external-context/better-auth/nextjs-integration.md`
- `.tmp/external-context/better-auth/drizzle-adapter.md`

### Next.js
- `.tmp/external-context/next.js/app-router-setup.md`
```

### Example 2: TanStack Query + Server Components

**Main Agent Flow**:
```
1. User asks: "How do I use TanStack Query with Next.js Server Components?"
2. Main agent calls ExternalScout
3. ExternalScout fetches:
   - tanstack-query/server-components.md
   - tanstack-query/prefetching.md
   - next.js/server-components.md
4. ExternalScout persists to .tmp/external-context/
5. Main agent creates session with external context references
6. Subagents read and implement using external docs
```

---

## Troubleshooting

### External Context Files Not Found

**Problem**: Subagent can't find `.tmp/external-context/{package-name}/{topic}.md`

**Solution**:
1. Check that ExternalScout ran successfully
2. Verify file path in session context matches actual file location
3. Check `.manifest.json` to see what's cached
4. If missing, re-run ExternalScout to fetch and persist

### Stale External Context

**Problem**: External docs are outdated (>7 days old)

**Solution**:
1. Delete stale files: `rm -rf .tmp/external-context/{package-name}/`
2. Update `.manifest.json`
3. Re-run ExternalScout to fetch fresh docs
4. Update session context with new file paths

### Manifest Out of Sync

**Problem**: `.manifest.json` doesn't match actual files

**Solution**:
1. Regenerate manifest by listing actual files:
   ```bash
   find .tmp/external-context -name "*.md" | sort
   ```
2. Update `.manifest.json` to match
3. Verify all files have metadata headers

---

## References

- **ExternalScout**: `.opencode/agent/subagents/core/externalscout.md` — Fetches and persists external docs
- **Task Delegation**: `/Users/apple/.config/opencode/context/core/workflows/task-delegation-basics.md` — How to reference external context in sessions
- **Session Management**: `/Users/apple/.config/opencode/context/core/workflows/session-management.md` — Session lifecycle
- **Library Registry**: `.opencode/skills/context7/library-registry.md` — Supported libraries and query patterns
