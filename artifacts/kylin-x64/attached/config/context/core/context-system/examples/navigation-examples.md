<!-- Context: core/navigation-examples | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Examples: Navigation Files

**Purpose**: Real-world examples of good navigation files

**Last Updated**: 2026-01-08

---

## Example 1: Category Navigation (Function-Based)

**File**: `openagents-repo/navigation.md`

**Pattern**: Function-Based (repository-specific)

**Token count**: ~250 tokens

```markdown
# OpenAgents Control Repository Navigation

**Purpose**: Navigate OpenAgents Control repository context

---

## Structure

```
openagents-repo/
├── navigation.md
├── quick-start.md
│
├── core-concepts/
│   ├── agent-architecture.md
│   ├── eval-framework.md
│   └── registry-system.md
│
├── guides/
│   ├── adding-agent.md
│   ├── testing-agent.md
│   └── debugging-issues.md
│
├── lookup/
│   ├── commands.md
│   └── file-locations.md
│
└── errors/
    └── tool-permission-errors.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **New here** | `quick-start.md` |
| **Add agent** | `guides/adding-agent.md` |
| **Test agent** | `guides/testing-agent.md` |
| **Debug issue** | `guides/debugging-issues.md` |
| **Find files** | `lookup/file-locations.md` |
| **Fix error** | `errors/tool-permission-errors.md` |

---

## By Type

**Core Concepts** → Foundational understanding (agents, evals, registry)
**Guides** → Step-by-step workflows
**Lookup** → Quick reference tables
**Errors** → Troubleshooting
```

**Why this works**:
- ✅ Token-efficient (~250 tokens)
- ✅ ASCII tree shows structure
- ✅ Quick routes for common tasks
- ✅ Organized by information type

---

## Example 2: Category Navigation (Concern-Based)

**File**: `development/navigation.md`

**Pattern**: Concern-Based (multi-technology)

**Token count**: ~280 tokens

```markdown
# Development Navigation

**Purpose**: Software development across all stacks

---

## Structure

```
development/
├── navigation.md
├── ui-navigation.md           # Specialized
├── backend-navigation.md      # Specialized
│
├── principles/
│   ├── clean-code.md
│   └── api-design.md
│
├── frontend/
│   ├── react/
│   └── vue/
│
├── backend/
│   ├── api-patterns/
│   ├── nodejs/
│   └── authentication/
│
└── data/
    ├── sql-patterns/
    └── orm-patterns/
```

---

## Quick Routes

| Task | Path |
|------|------|
| **UI/Frontend** | `ui-navigation.md` |
| **Backend/API** | `backend-navigation.md` |
| **Clean code** | `principles/clean-code.md` |
| **API design** | `principles/api-design.md` |

---

## By Concern

**Principles** → Universal development practices
**Frontend** → React, Vue, state management
**Backend** → APIs, Node.js, Python, auth
**Data** → SQL, NoSQL, ORMs
```

**Why this works**:
- ✅ Token-efficient (~280 tokens)
- ✅ Shows specialized navigation files
- ✅ Organized by concern (frontend, backend, data)
- ✅ Points to specialized navigation for complex workflows

---

## Example 3: Specialized Navigation

**File**: `development/ui-navigation.md`

**Pattern**: Cross-cutting (spans multiple categories)

**Token count**: ~270 tokens

```markdown
# UI Development Navigation

**Scope**: Frontend code + visual design

---

## Structure

```
Frontend Code (development/frontend/):
├── react/
│   ├── hooks-patterns.md
│   ├── component-architecture.md
│   └── tanstack/
│       ├── query-patterns.md
│       └── router-patterns.md
└── vue/

Visual Design (ui/web/):
├── animation-patterns.md
├── ui-styling-standards.md
└── design-systems.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **React patterns** | `frontend/react/hooks-patterns.md` |
| **TanStack Query** | `frontend/react/tanstack/query-patterns.md` |
| **Animations** | `../../ui/web/animation-patterns.md` |
| **Styling** | `../../ui/web/ui-styling-standards.md` |

---

## By Framework

**React** → `frontend/react/`
**Vue** → `frontend/vue/`
**TanStack** → `frontend/react/tanstack/`

## By Concern

**Code patterns** → `development/frontend/`
**Visual design** → `ui/web/`
```

**Why this works**:
- ✅ Token-efficient (~270 tokens)
- ✅ Spans multiple categories (development/ + ui/)
- ✅ Task-focused (UI development)
- ✅ Shows both code and design paths

---

## Example 4: Subcategory Navigation

**File**: `development/backend/navigation.md`

**Pattern**: Concern-based subcategory

**Token count**: ~240 tokens

```markdown
# Backend Development Navigation

**Scope**: Server-side, APIs, databases, auth

---

## Structure

```
backend/
├── navigation.md
│
├── api-patterns/
│   ├── rest-design.md
│   ├── graphql-design.md
│   └── grpc-patterns.md
│
├── nodejs/
│   ├── express-patterns.md
│   └── fastify-patterns.md
│
├── python/
│   └── fastapi-patterns.md
│
└── authentication/
    ├── jwt-patterns.md
    └── oauth-patterns.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **REST API** | `api-patterns/rest-design.md` |
| **GraphQL** | `api-patterns/graphql-design.md` |
| **Node.js** | `nodejs/express-patterns.md` |
| **Auth (JWT)** | `authentication/jwt-patterns.md` |

---

## By Approach

**REST** → `api-patterns/rest-design.md`
**GraphQL** → `api-patterns/graphql-design.md`

## By Language

**Node.js** → `nodejs/`
**Python** → `python/`
```

**Why this works**:
- ✅ Token-efficient (~240 tokens)
- ✅ Organized by approach first (REST, GraphQL)
- ✅ Then by tech (Node.js, Python)
- ✅ Functional concerns separate (authentication/)

---

## Example 5: Full-Stack Navigation

**File**: `development/fullstack-navigation.md`

**Pattern**: Workflow-focused

**Token count**: ~300 tokens

```markdown
# Full-Stack Development Navigation

**Scope**: End-to-end application development

---

## Common Stacks

### MERN (MongoDB, Express, React, Node)
```
Frontend: development/frontend/react/
Backend:  development/backend/nodejs/express-patterns.md
Data:     development/data/nosql-patterns/mongodb.md
API:      development/backend/api-patterns/rest-design.md
```

### T3 Stack (Next.js, tRPC, Prisma, Tailwind)
```
Frontend: development/frontend/react/ + ui/web/ui-styling-standards.md
Backend:  development/backend/nodejs/ + api-patterns/trpc-patterns.md
Data:     development/data/orm-patterns/prisma.md
```

---

## Quick Routes

| Layer | Navigate To |
|-------|-------------|
| **Frontend** | `ui-navigation.md` |
| **Backend** | `backend-navigation.md` |
| **Data** | `data/navigation.md` |

---

## Common Workflows

**New API endpoint**:
1. `principles/api-design.md` (principles)
2. `backend/api-patterns/rest-design.md` (approach)
3. `backend/nodejs/express-patterns.md` (implementation)

**New React feature**:
1. `frontend/react/component-architecture.md` (structure)
2. `frontend/react/hooks-patterns.md` (logic)
3. `ui/web/ui-styling-standards.md` (styling)
```

**Why this works**:
- ✅ Token-efficient (~300 tokens)
- ✅ Shows common tech stacks
- ✅ Workflow-focused (how to build features)
- ✅ Points to layer-specific navigation

---

## Example 6: Minimal Navigation

**File**: `content/navigation.md`

**Pattern**: Simple category (few files)

**Token count**: ~150 tokens

```markdown
# Content Navigation

**Purpose**: Copywriting and content creation

---

## Structure

```
content/
├── navigation.md
├── copywriting-frameworks.md
└── tone-voice.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **Write copy** | `copywriting-frameworks.md` |
| **Set tone** | `tone-voice.md` |

---

## Files

**copywriting-frameworks.md** → AIDA, PAS, persuasive writing
**tone-voice.md** → Brand voice, tone guidelines
```

**Why this works**:
- ✅ Token-efficient (~150 tokens)
- ✅ Simple structure (only 2 files)
- ✅ No unnecessary complexity
- ✅ Clear and scannable

---

## Anti-Patterns (What NOT to Do)

### ❌ Too Verbose

```markdown
# Development Navigation

**Purpose**: This comprehensive navigation file is designed to help you navigate the extensive collection of software development patterns, standards, and best practices that we have carefully curated across all technology stacks including frontend frameworks like React and Vue, backend technologies such as Node.js and Python, database systems both SQL and NoSQL, and infrastructure tools for deployment and operations.

## Introduction

The development category represents a significant portion of our context system...

[Continues for 800+ tokens]
```

**Problems**:
- ❌ 800+ tokens (should be 200-300)
- ❌ Verbose explanations (should be concise)
- ❌ Hard to scan (should use tables/trees)

---

### ❌ Missing Structure

```markdown
# Development Navigation

Here are the files:
- clean-code.md
- api-design.md
- react-patterns.md
- express-patterns.md
```

**Problems**:
- ❌ No ASCII tree (hard to see hierarchy)
- ❌ No quick routes (hard to find tasks)
- ❌ No organization (just a list)

---

### ❌ Too Detailed

```markdown
# Development Navigation

## React Patterns

### Hooks
React hooks allow you to use state and lifecycle features in functional components. The most common hooks are:

1. useState - For managing component state
   - Syntax: const [state, setState] = useState(initialValue)
   - Example: const [count, setCount] = useState(0)
   
2. useEffect - For side effects
   [... continues with full documentation]
```

**Problems**:
- ❌ Contains file contents (should just point to files)
- ❌ Duplicates information (should reference, not repeat)
- ❌ Too detailed (navigation, not documentation)

---

## Key Takeaways

### ✅ Good Navigation Files

1. **Token-efficient** (200-300 tokens)
2. **Scannable** (ASCII trees, tables)
3. **Task-focused** (quick routes)
4. **Organized** (by concern/type)
5. **Concise** (3-5 word descriptions)

### ❌ Bad Navigation Files

1. **Verbose** (500+ tokens)
2. **Hard to scan** (paragraphs)
3. **Unfocused** (no clear routes)
4. **Unorganized** (just lists)
5. **Detailed** (duplicates content)

---

## Related

- `../guides/navigation-design.md` - How to create navigation files
- `../guides/organizing-context.md` - How to choose organizational pattern
- `../standards/mvi.md` - Minimal Viable Information principle
