# Context7 Skill

## Purpose

Fetches **live, version-specific documentation** for external libraries and frameworks using the Context7 API. Ensures you always get current API patterns instead of potentially outdated training data.

**Golden Rule**: Always fetch live docs for external libraries—training data may be outdated.

## Quick Start

### Recommended: Use ExternalScout Subagent

The **ExternalScout** subagent is the recommended way to fetch external documentation. It handles:
- Library detection
- Query optimization
- Documentation filtering and sorting
- Formatted results with code examples

**Invocation**:
```
Use ExternalScout to fetch documentation for [Library Name]: [your specific question]
```

**Example**:
```
Use ExternalScout to fetch documentation for Drizzle ORM: How do I set up modular schemas with PostgreSQL?
```

### Alternative: Direct Skill Usage

You can also invoke the Context7 skill directly via bash:

```bash
# Step 1: Search for library
curl -s "https://context7.com/api/v2/libs/search?libraryName=LIBRARY&query=TOPIC" | jq '.results[0]'

# Step 2: Fetch documentation
curl -s "https://context7.com/api/v2/context?libraryId=LIBRARY_ID&query=OPTIMIZED_QUERY&type=txt"
```

See `SKILL.md` for detailed API documentation.

## Supported Libraries

See `library-registry.md` for the complete list of supported libraries including:
- **Database & ORM**: Drizzle, Prisma
- **Authentication**: Better Auth, NextAuth.js, Clerk
- **Frontend**: Next.js, React, TanStack Query/Router/Start
- **Infrastructure**: Cloudflare Workers, AWS Lambda, Vercel
- **UI**: Shadcn/ui, Radix UI, Tailwind CSS
- **State**: Zustand, Jotai
- **Validation**: Zod, React Hook Form
- **Testing**: Vitest, Playwright

## Workflow

```
User Query
    ↓
ContextScout (searches internal context)
    ↓
No internal context found
    ↓
ContextScout recommends ExternalScout
    ↓
ExternalScout invoked
    ├─ Reads library-registry.md
    ├─ Detects library
    ├─ Loads query patterns
    ├─ Fetches from Context7 API
    ├─ Filters & sorts results
    └─ Returns formatted documentation
    ↓
User receives current, actionable docs
```

## Files

- **`SKILL.md`** - Context7 API documentation and usage
- **`library-registry.md`** - Supported libraries, aliases, and query patterns
- **`README.md`** - This file (overview and quick start)

## Adding New Libraries

To add a new library to the registry:

1. Edit `library-registry.md`
2. Add entry under appropriate category:
   ```markdown
   #### Library Name
   - **Aliases**: `alias1`, `alias2`, `package-name`
   - **Docs**: https://example.com/docs
   - **Context7**: `use context7 for library-name`
   - **Common topics**: topic1, topic2, topic3
   ```
3. (Optional) Add query optimization patterns
4. ExternalScout will automatically detect the new library

## Related

- **ExternalScout**: `.opencode/agent/subagents/core/externalscout.md`
- **ContextScout**: `.opencode/agent/subagents/core/contextscout.md`
