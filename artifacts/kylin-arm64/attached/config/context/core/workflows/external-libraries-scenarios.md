<!-- Context: workflows/external-libraries-scenarios | Priority: medium | Version: 1.0 | Updated: 2026-02-05 -->
# External Libraries: Common Scenarios

**Purpose**: Real-world examples of using ExternalScout

---

## Scenario 1: New Build with External Packages

**Example**: Next.js app with Drizzle + Better Auth

**Process:**
1. Check install scripts: `ls scripts/install/`
2. Identify packages: Next.js, Drizzle ORM, Better Auth
3. ExternalScout for each package
4. Check requirements: PostgreSQL? Env vars?
5. Verify version compatibility
6. Implement following current docs
7. Test integration points

**ExternalScout calls:**
```javascript
// Drizzle ORM
task(
  subagent_type="ExternalScout",
  description="Fetch Drizzle PostgreSQL setup",
  prompt="Fetch Drizzle ORM docs: PostgreSQL setup w/ modular schemas
  Focus on: Installation | DB connection | Schema patterns | Migrations
  Context: Next.js commerce site w/ PostgreSQL"
)

// Next.js App Router
task(
  subagent_type="ExternalScout",
  description="Fetch Next.js App Router docs",
  prompt="Fetch Next.js docs: App Router w/ Server Actions
  Focus on: Installation | Directory structure | Server Actions
  Context: Commerce site w/ order processing"
)
```

---

## Scenario 2: Package Error During Build

**Example**: `Error: Cannot find module 'drizzle-orm/pg-core'`

**Process:**
1. Identify package: Drizzle ORM
2. ExternalScout: "Fetch Drizzle docs: PostgreSQL imports"
3. Check current import patterns
4. Verify package.json has correct deps
5. Propose fix from current docs
6. Request approval → Apply fix

---

## Scenario 3: First-Time Package Setup

**Example**: Setting up TanStack Query in Next.js

**Process:**
1. Check install scripts
2. ExternalScout: "Fetch TanStack Query docs: Next.js App Router setup"
3. Get: Install steps | Peer deps | Config | Patterns
4. If install script exists: Review → Run
5. If no script: Follow docs for manual setup
6. Implement → Test

---

## Scenario 4: Version Upgrade

**Example**: Next.js 14 → 15

**Process:**
1. ExternalScout: "Fetch Next.js 15 docs: Breaking changes and migration"
2. Review breaking changes
3. Identify affected code
4. Plan migration steps
5. Request approval → Implement → Test

---

## Real-World Example: Auth Implementation

**Task**: "Add authentication with Better Auth to Next.js commerce"

```javascript
// 1. ContextScout: Project standards
task(
  subagent_type="ContextScout",
  description="Find auth standards",
  prompt="Find context files: Auth patterns | Security standards"
)
// Returns: security-patterns.md, code-quality.md

// 2. ExternalScout: Better Auth docs (MANDATORY)
task(
  subagent_type="ExternalScout",
  description="Fetch Better Auth + Next.js docs",
  prompt="Fetch Better Auth docs: Next.js App Router integration
  Focus on: Installation | App Router setup | Drizzle adapter | Session mgmt
  Context: Adding auth to Next.js commerce w/ Drizzle ORM"
)
// Returns: Installation | Integration patterns | Working examples

// 3. Combine and implement
// - Better Auth patterns (from ExternalScout)
// - Security standards (from ContextScout)
// = Secure, well-structured auth ✅
```

---

## Error Handling Patterns

| Error Type | Process |
|------------|---------|
| **Package Installation** | ExternalScout: installation docs → Verify package name/version → Check peer deps |
| **Import/Module** | ExternalScout: import patterns → Check current API exports |
| **API/Configuration** | ExternalScout: API docs → Check current signatures |
| **Build Errors** | Identify package → ExternalScout: relevant docs → Check known issues |

---

## Related

- `external-libraries-workflow.md` - Core workflow
- `external-libraries-faq.md` - Troubleshooting FAQ
