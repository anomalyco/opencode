<!-- Context: core/context-system | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Context System

**Purpose**: Minimal, concern-based knowledge organization for AI agents

**Last Updated**: 2026-01-08

---

## Core Principles

### 1. Minimal Viable Information (MVI)
Extract only core concepts (1-3 sentences), key points (3-5 bullets), minimal example, and reference link. 
**Goal**: Scannable in <30 seconds. Reference full docs, don't duplicate them.

### 2. Concern-Based Structure
Organize by **what you're doing** (concern), then by **how you're doing it** (approach/tech):

**Two organizational patterns**:

#### Pattern A: Function-Based (for repository-specific context)
```
category/
├── navigation.md
├── concepts/              # What it is
├── examples/              # Working code
├── guides/                # How to do it
├── lookup/                # Quick reference
└── errors/                # Common issues
```

**Use when**: Content is repository-specific (e.g., `openagents-repo/`)

#### Pattern B: Concern-Based (for development context)
```
category/
├── navigation.md
├── {concern}/             # Organize by what you're doing
│   ├── navigation.md
│   ├── {approach}/        # Then by approach/tech
│   │   ├── navigation.md
│   │   └── {files}.md
```

**Use when**: Content spans multiple technologies (e.g., `development/`)

**Examples**:
- `development/backend/api-patterns/` - Concern: backend, Approach: API patterns
- `development/backend/nodejs/` - Concern: backend, Tech: Node.js
- `development/frontend/react/` - Concern: frontend, Tech: React

### 3. Token-Efficient Navigation
Every category/subcategory has `navigation.md` with:
- **ASCII tree** for quick structure scan (~50 tokens)
- **Quick routes table** for common tasks (~100 tokens)
- **By concern/type** sections (~50 tokens)
- **Total**: ~200-300 tokens per navigation file

**Why**: Faster loading, less cost, quicker AI decisions

### 4. Specialized Navigation Files
For cross-cutting concerns, create specialized navigation:
- `development/ui-navigation.md` - Spans frontend/ + ui/
- `development/backend-navigation.md` - Covers APIs, auth, middleware
- `development/fullstack-navigation.md` - Common tech stacks

**Why**: Real workflows don't fit neat categories

### 5. Self-Describing Filenames
Filenames should tell you what's inside:
- ❌ `code.md` → ✅ `code-quality.md`
- ❌ `tests.md` → ✅ `test-coverage.md`
- ❌ `review.md` → ✅ `code-review.md`

**Why**: No need to open files to understand content

### 6. Knowledge Harvesting
Extract valuable context from AI summaries/overviews, then delete them. Workspace stays clean, knowledge persists.

### 5. Technology Context Organization

**Purpose**: Ensure consistent placement of new technologies (frameworks, libraries, tools) to maintain discoverability.

**Frameworks vs Architectural Layers**:

- **Full-Stack Frameworks** (e.g., Tanstack Start, Next.js): Add under `development/frameworks/{tech}/`. These are "meta-frameworks" that span multiple layers.
- **Specialized Concerns** (e.g., AI, Data): Add under `development/{concern}/{tech}/`.
- **Layer-Specific Tech** (e.g., React, Node.js): Add under `development/{frontend|backend}/{tech}/`.

**Decision Process**:
1. Is it a full-stack framework? → `development/frameworks/`
2. Is it a specialized domain (AI, Data)? → `development/{domain}/`
3. Is it layer-specific? → `development/{frontend|backend}/`

---

## Directory Patterns

### Pattern A: Function-Based (Repository-Specific)

**Use for**: Repository-specific context (e.g., `openagents-repo/`)

```
/Users/apple/.config/opencode/context/{category}/
├── navigation.md              # Fast, token-efficient navigation
├── quick-start.md             # Optional: 2-minute orientation
│
├── core-concepts/             # Foundational concepts (optional)
│   ├── navigation.md
│   └── {concept}.md
│
├── concepts/                  # What it is
│   ├── navigation.md
│   └── {concept}.md
│
├── examples/                  # Working code
│   ├── navigation.md
│   └── {example}.md
│
├── guides/                    # How to do it
│   ├── navigation.md
│   └── {guide}.md
│
├── lookup/                    # Quick reference
│   ├── navigation.md
│   └── {lookup}.md
│
└── errors/                    # Common issues
    ├── navigation.md
    └── {error}.md
```

---

### Pattern B: Concern-Based (Development Context)

**Use for**: Multi-technology development context (e.g., `development/`)

```
/Users/apple/.config/opencode/context/{category}/
├── navigation.md                       # Main navigation
├── {concern}-navigation.md             # Specialized navigation (optional)
│
├── principles/                         # Universal principles (optional)
│   ├── navigation.md
│   └── {principle}.md
│
├── {concern}/                          # Organize by concern
│   ├── navigation.md
│   │
│   ├── {approach}/                     # Then by approach
│   │   ├── navigation.md
│   │   └── {pattern}.md
│   │
│   └── {tech}/                         # Or by tech
│       ├── navigation.md
│       └── {pattern}.md
```

**Example**:
```
development/
├── navigation.md
├── ui-navigation.md                    # Specialized
├── backend-navigation.md               # Specialized
├── fullstack-navigation.md             # Specialized
│
├── principles/                         # Universal
│   ├── clean-code.md
│   └── api-design.md
│
├── frontend/                           # Concern
│   ├── react/                          # Tech
│   │   ├── hooks-patterns.md
│   │   └── tanstack/                   # Sub-tech
│   │       ├── query-patterns.md
│   │       └── router-patterns.md
│   └── vue/                            # Tech
│
├── backend/                            # Concern
│   ├── api-patterns/                   # Approach
│   │   ├── rest-design.md
│   │   └── graphql-design.md
│   ├── nodejs/                         # Tech
│   └── authentication/                 # Functional concern
│
└── data/                               # Concern
    ├── sql-patterns/                   # Approach
    └── orm-patterns/                   # Approach
```

---

## Navigation File Format

### Token-Efficient Template

```markdown
# {Category} Navigation

**Purpose**: [1 sentence]

---

## Structure

```
{category}/
├── navigation.md
├── {subcategory}/
│   ├── navigation.md
│   └── {files}.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **{Task 1}** | `{path}` |
| **{Task 2}** | `{path}` |

---

## By {Concern/Type}

**{Section 1}** → {description}
**{Section 2}** → {description}
```

**Target**: 200-300 tokens

---

## Organizing Principles

### 1. Core Standards (Universal)

Location: `/Users/apple/.config/opencode/context/core/standards/`

**Purpose**: Universal standards that apply to ALL development

**Content**:
- Code quality principles (all languages)
- Test coverage standards
- Documentation standards
- Security patterns
- Code analysis approaches

**Used by**: All agents, all projects

**Effect on other categories**: 
- Other categories can reference these standards
- Users can edit core standards to affect context flow globally
- Development-specific standards go in `development/principles/`

---

### 2. Development Principles vs Core Standards

| Location | Scope | Examples |
|----------|-------|----------|
| `core/standards/` | **Universal** (all projects, all languages) | Code quality, testing, docs, security |
| `development/principles/` | **Development-specific** (software engineering) | Clean code, API design, error handling |

**Both exist**: Core standards are universal, development principles are domain-specific

---

### 3. Data Context Location

**Decision**: Data patterns live in `development/data/` (not top-level)

**Rationale**: Data layer is part of development workflow

**Structure**:
```
development/data/
├── navigation.md
├── sql-patterns/
├── nosql-patterns/
└── orm-patterns/
```

**Top-level `data/` category**: Reserved for data engineering/analytics (different concern)

---

### 4. Specialized Navigation Strategy

**Full-stack navigation includes**:
- Quick routes (table format)
- Common stack patterns (MERN, T3, etc.)

**Example**:
```markdown
## Quick Routes
| Task | Path |
|------|------|
| **Frontend** | `ui-navigation.md` |

## Common Stacks

### MERN Stack
Frontend: development/frontend/react/
Backend:  development/backend/nodejs/
Data:     development/data/nosql-patterns/mongodb.md
```

---

## Operations

### Harvest (`/context harvest`)

**Purpose**: Extract knowledge from summary files → permanent context, then clean up.

**Process**:
1. Scan for patterns: `*OVERVIEW.md`, `*SUMMARY.md`, `SESSION-*.md`, `CONTEXT-*.md`
2. Analyze content:
   - Design decisions → `concepts/`
   - Solutions/patterns → `examples/`
   - Workflows → `guides/`
   - Errors encountered → `errors/`
   - Reference data → `lookup/`
3. Present approval UI (letter-based: `A B C` or `all`)
4. Extract + minimize (apply MVI)
5. Archive/delete summaries
6. Report results

---

### Extract (`/context extract`)

**Purpose**: Extract context from docs/code/URLs.

**Process**:
1. Read source
2. Extract core concepts (1-3 sentences each)
3. Find minimal examples
4. Identify workflows (numbered steps)
5. Build lookup tables
6. Capture errors/gotchas
7. Create references

**Output**: Follow MVI template

---

### Organize (`/context organize`)

**Purpose**: Restructure existing files into appropriate pattern.

**Process**:
1. Scan category
2. Determine pattern (function-based or concern-based)
3. Create missing directories
4. Move/refactor files
5. Update navigation.md
6. Fix references

---

### Update (`/context update`)

**Purpose**: Update context when APIs/frameworks change.

**Process**:
1. Identify what changed
2. Find affected files
3. Update concepts, examples, guides, lookups
4. Add migration notes to errors/
5. Validate references

---

## File Naming Conventions

### Navigation Files
- `navigation.md` - Main navigation for category/subcategory
- `{domain}-navigation.md` - Specialized cross-cutting navigation

### Content Files
- Use descriptive names: `code-quality.md` not `code.md`
- Include type when helpful: `rest-design.md`, `jwt-patterns.md`
- Use kebab-case: `scroll-linked-animations.md`

---

## Extraction Rules

### ✅ Extract:
- Core concepts (minimal)
- Essential patterns
- Step-by-step workflows
- Critical errors
- Quick reference data
- Links to detailed docs

### ❌ Don't Extract:
- Verbose explanations
- Complete API docs
- Implementation details
- Historical context
- Marketing content
- Duplicate info

---

## Success Criteria

✅ **Minimal** - Core info only, <200 lines per file
✅ **Navigable** - navigation.md at every level
✅ **Organized** - Appropriate pattern (function-based or concern-based)
✅ **Token-efficient** - Navigation files ~200-300 tokens
✅ **Self-describing** - Filenames tell you what's inside
✅ **Referenceable** - Links to full docs
✅ **Searchable** - Easy to find via navigation
✅ **Maintainable** - Easy to update

---

## Related Documentation

- `context-system/guides/navigation-design.md` - How to create navigation files
- `context-system/guides/organizing-context.md` - How to choose organizational pattern
- `context-system/examples/navigation-examples.md` - Good navigation examples
- `context-system/standards/templates.md` - File templates

---

## Quick Commands

```bash
/context                      # Quick scan, suggest actions
/context harvest              # Clean up summaries → permanent context
/context extract {source}     # From docs/code/URLs
/context organize {category}  # Restructure flat files → function folders
/context update {what}        # When APIs/frameworks change
/context migrate              # Move global project-intelligence → local project
/context create {category}    # Create new context category
/context error {error}        # Add recurring error to knowledge base
/context compact {file}       # Minimize verbose file to MVI format
/context map [category]       # View context structure
/context validate             # Check integrity, references, sizes
```

**All operations show a preview of what will be created/moved/deleted before asking for approval.**
