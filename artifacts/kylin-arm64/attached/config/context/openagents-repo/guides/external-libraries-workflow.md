<!-- Context: openagents-repo/guides/external-libraries-workflow | Priority: high | Version: 1.0 | Updated: 2026-01-29 -->
# Guide: External Libraries Workflow

**Purpose**: Fetch current documentation for external packages when adding agents or skills

**When to Use**: Any time you're working with external libraries (Drizzle, Better Auth, Next.js, etc.)

**Time to Read**: 5 minutes

---

## Quick Start

**Golden Rule**: NEVER rely on training data for external libraries → ALWAYS fetch current docs

**Process**:
1. Detect external package in your task
2. Check for install scripts (if first-time setup)
3. Use **ExternalScout** to fetch current documentation
4. Implement with fresh, version-specific knowledge

---

## When to Use ExternalScout (MANDATORY)

✅ **Use ExternalScout when**:
- Adding new agents that depend on external packages
- Adding new skills that integrate with external libraries
- First-time package setup in your implementation
- Package/dependency errors occur
- Version upgrades are needed
- ANY external library work

❌ **Don't rely on**:
- Training data (outdated, often wrong)
- Old documentation (APIs change)
- Assumptions about package behavior

---

## Why This Matters

**Example**: Next.js Evolution
```
Training data (2023): Next.js 13 uses pages/ directory
Current (2025): Next.js 15 uses app/ directory (App Router)

Training data = broken code ❌
ExternalScout = working code ✅
```

**Real Impact**:
- APIs change (new methods, deprecated features)
- Configuration patterns evolve
- Breaking changes happen frequently
- Version-specific features differ

---

## Workflow Steps

### Step 1: Detect External Package

**Triggers**:
- User mentions a library name
- You see imports in code
- package.json has new dependencies
- Build errors reference external packages

**Action**: Identify which external packages are involved

**Example**:
```
User: "Add authentication with Better Auth"
→ External package detected: Better Auth
→ Proceed to Step 2
```

---

### Step 2: Check Install Scripts (First-Time Only)

**For first-time package setup**, check if there are install scripts:

```bash
# Look for install scripts
ls scripts/install/ scripts/setup/ bin/install* setup.sh install.sh

# Check package-specific requirements
grep -r "postinstall\|preinstall" package.json
```

**If scripts exist**:
- Read them to understand setup order
- Check for environment variables needed
- Identify prerequisites (database, services)
- Follow their guidance before implementing

**Why**: Scripts may set up databases, generate files, or configure services in a specific order

---

### Step 3: Fetch Current Documentation (MANDATORY)

**Use ExternalScout** to get live, version-specific documentation:

```bash
# Invoke ExternalScout via task tool
task(
  subagent_type="ExternalScout",
  description="Fetch Drizzle ORM documentation",
  prompt="Fetch current documentation for Drizzle ORM focusing on:
          - Modular schema patterns
          - Next.js integration
          - Database setup
          - Migration strategies"
)
```

**What ExternalScout Returns**:
- Live documentation from official sources
- Version-specific features
- Integration patterns
- Setup requirements
- Code examples

**Supported Libraries** (18+):
- Drizzle ORM
- Better Auth
- Next.js
- TanStack Query/Router/Start
- Cloudflare Workers
- AWS Lambda
- Vercel
- Shadcn/ui
- Radix UI
- Tailwind CSS
- Zustand
- Jotai
- Zod
- React Hook Form
- Vitest
- Playwright
- And more...

---

### Step 4: Implement with Fresh Knowledge

**Now implement** using the documentation from ExternalScout:
- Follow current best practices
- Use version-specific APIs
- Apply recommended patterns
- Reference the fetched docs in your code

---

## Integration with Agent/Skill Creation

### When Adding an Agent

1. Read: `guides/adding-agent.md`
2. **If agent uses external packages**:
   - Use ExternalScout to fetch docs
   - Document dependencies in agent metadata
   - Add to registry with correct versions
3. Test: `guides/testing-agent.md`

### When Adding a Skill

1. Read: `guides/adding-skill.md`
2. **If skill uses external packages**:
   - Use ExternalScout to fetch docs
   - Document dependencies in skill metadata
   - Add to registry with correct versions
3. Test: `guides/testing-subagents.md`

---

## Common Packages in OpenAgents

| Package | Use Case | Priority |
|---------|----------|----------|
| **Drizzle ORM** | Database schemas & queries | ⭐⭐⭐⭐⭐ |
| **Better Auth** | Authentication & authorization | ⭐⭐⭐⭐⭐ |
| **Next.js** | Full-stack web framework | ⭐⭐⭐⭐⭐ |
| **TanStack Query** | Server state management | ⭐⭐⭐⭐ |
| **Zod** | Schema validation | ⭐⭐⭐⭐ |
| **Tailwind CSS** | Styling | ⭐⭐⭐⭐ |
| **Shadcn/ui** | UI components | ⭐⭐⭐ |
| **Vitest** | Testing framework | ⭐⭐⭐ |

---

## Checklist

Before implementing with external libraries:

- [ ] Identified all external packages involved
- [ ] Checked for install scripts (if first-time)
- [ ] Used ExternalScout to fetch current docs
- [ ] Reviewed version-specific features
- [ ] Documented dependencies in metadata
- [ ] Added to registry with correct versions
- [ ] Tested implementation thoroughly
- [ ] Referenced ExternalScout docs in code comments

---

## Related Guides

- `guides/adding-agent.md` - Creating new agents
- `guides/adding-skill.md` - Creating new skills
- `guides/debugging.md` - Troubleshooting (includes dependency issues)
- `guides/updating-registry.md` - Registry management

---

## Key Principle

> **External libraries change constantly. Your training data is outdated. Always fetch current documentation before implementing.**

This is not optional - it's the difference between working code and broken code.
