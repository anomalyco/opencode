# Core Concept: Agents

**Purpose**: Understanding how agents work in OpenAgents Control  
**Priority**: CRITICAL - Load this before working with agents

---

## What Are Agents?

Agents are AI prompt files that define specialized behaviors for different tasks. They are:
- **Markdown files** with frontmatter metadata
- **Category-organized** by domain (core, development, content, etc.)
- **Context-aware** - load relevant context files
- **Testable** - validated through eval framework

---

## Agent Structure

### File Format

```markdown
---
description: "Brief description of what this agent does"
category: "category-name"
type: "agent"
tags: ["tag1", "tag2"]
dependencies: ["subagent:tester"]
---

# Agent Name

[Agent prompt content - instructions, workflows, constraints]
```

### Key Components

1. **Frontmatter** (YAML metadata)
   - `description`: Brief description
   - `category`: Category name (core, development, content, etc.)
   - `type`: Always "agent"
   - `tags`: Optional tags for discovery
   - `dependencies`: Optional dependencies (e.g., subagents)

2. **Prompt Content**
   - Instructions and workflows
   - Constraints and rules
   - Context loading requirements
   - Tool usage patterns

---

## Category System

Agents are organized by domain expertise:

### Core Category (`core/`)
**Purpose**: Essential system agents (always available)

Agents:
- `openagent.md` - General-purpose orchestrator
- `opencoder.md` - Development specialist
- `system-builder.md` - System generation

**When to use**: System-level tasks, orchestration

---

### Development Category (`development/`)
**Purpose**: Software development specialists

Agents:
- `frontend-specialist.md` - React, Vue, modern CSS
- `devops-specialist.md` - CI/CD, deployment, infrastructure

**When to use**: Building applications, dev tasks

---

### Content Category (`content/`)
**Purpose**: Content creation specialists

Agents:
- `copywriter.md` - Marketing copy, persuasive writing
- `technical-writer.md` - Documentation, technical content

**When to use**: Writing, documentation, marketing

---

### Data Category (`data/`)
**Purpose**: Data analysis specialists

Agents:
- `data-analyst.md` - Data analysis, visualization

**When to use**: Data tasks, analysis, reporting

---

### Product Category (`product/`)
**Purpose**: Product management specialists

**Status**: Ready for agents (no agents yet)

**When to use**: Product strategy, roadmaps, requirements

---

### Learning Category (`learning/`)
**Purpose**: Education and coaching specialists

**Status**: Ready for agents (no agents yet)

**When to use**: Teaching, training, curriculum

---

## Subagents

**Location**: `.opencode/agent/subagents/`

**Purpose**: Delegated specialists for specific subtasks

### Subagent Categories

1. **code/** - Code-related specialists
   - `tester.md` - Test authoring and TDD
   - `reviewer.md` - Code review and security
   - `coder-agent.md` - Focused implementations
   - `build-agent.md` - Type checking and builds

2. **core/** - Core workflow specialists
   - `task-manager.md` - Task breakdown and management
   - `documentation.md` - Documentation generation

3. **system-builder/** - System generation specialists
   - `agent-generator.md` - Generate agent files
   - `command-creator.md` - Create slash commands
   - `domain-analyzer.md` - Analyze domains
   - `context-organizer.md` - Organize context
   - `workflow-designer.md` - Design workflows

4. **utils/** - Utility specialists
   - `image-specialist.md` - Image editing and analysis

### Subagents vs Category Agents

| Aspect | Category Agents | Subagents |
|--------|----------------|-----------|
| **Purpose** | User-facing specialists | Delegated subtasks |
| **Invocation** | Direct by user | Via task tool |
| **Scope** | Broad domain | Narrow focus |
| **Example** | `frontend-specialist` | `tester` |

---

## Claude Code Interop (Optional)

OpenAgents Control can pair with Claude Code for local workflows and distribution:

- **Subagents**: Project helpers in `.claude/agents/`
- **Skills**: Auto-invoked guidance in `.claude/skills/`
- **Hooks**: Shell commands on lifecycle events (use sparingly)
- **Plugins**: Share agents/skills/hooks across projects

Use this when you want Claude Code to follow OpenAgents Control standards or to ship reusable helpers.

---

## Path Resolution

The system supports multiple path formats for backward compatibility:

### Supported Formats

```bash
# Short ID (backward compatible)
"openagent" → resolves to → ".opencode/agent/core/openagent.md"

# Category path
"core/openagent" → resolves to → ".opencode/agent/core/openagent.md"

# Full category path
"development/frontend-specialist" → resolves to → ".opencode/agent/subagents/development/frontend-specialist.md"

# Subagent path
"TestEngineer" → resolves to → ".opencode/agent/subagents/code/test-engineer.md"
```

### Resolution Rules

1. Check if path includes `/` → use as category path
2. If no `/` → check core/ first (backward compat)
3. If not in core/ → search all categories
4. If not found → error

---

## Prompt Variants

**Location**: `.opencode/prompts/{category}/{agent}/`

**Purpose**: Model-specific prompt optimizations

### Supported Models

- `gemini.md` - Google Gemini optimizations
- `grok.md` - xAI Grok optimizations
- `llama.md` - Meta Llama optimizations
- `openrouter.md` - OpenRouter optimizations

### When to Create Variants

- Model has specific formatting requirements
- Model performs better with different structure
- Model has unique capabilities to leverage

### Fallback Behavior

If no variant exists for a model, the base agent file is used.

---

## Context Loading

Agents should load relevant context files based on task type:

### Core Context (Always Consider)

```markdown
<!-- Context: standards/code | Priority: critical -->
```

Loads: `/Users/apple/.config/opencode/context/core/standards/code-quality.md`

### Category Context

```markdown
<!-- Context: development/react-patterns | Priority: high -->
```

Loads: `/Users/apple/.config/opencode/context/ui/web/react-patterns.md`

### Multiple Contexts

```markdown
<!-- Context: standards/code, standards/tests | Priority: critical -->
```

---

## Agent Lifecycle

### 1. Creation
```bash
# Create agent file
touch .opencode/agent/{category}/{agent-name}.md

# Add frontmatter and content
# (See guides/adding-agent.md for details)
```

### 2. Testing
```bash
# Create test structure
mkdir -p evals/agents/{category}/{agent-name}/{config,tests}

# Run tests
cd evals/framework && npm run eval:sdk -- --agent={category}/{agent-name}
```

### 3. Registration
```bash
# Auto-detect and add to registry
./scripts/registry/auto-detect-components.sh --auto-add

# Validate
./scripts/registry/validate-registry.sh
```

### 4. Distribution
```bash
# Users install via install.sh
./install.sh {profile}
```

---

## Best Practices

### Agent Design

✅ **Single responsibility** - One domain, one agent  
✅ **Clear instructions** - Explicit workflows and constraints  
✅ **Context-aware** - Load relevant context files  
✅ **Testable** - Include eval tests  
✅ **Well-documented** - Clear description and usage  

### Naming Conventions

- **Category agents**: `{domain}-specialist.md` (e.g., `frontend-specialist.md`)
- **Core agents**: `{name}.md` (e.g., `openagent.md`)
- **Subagents**: `{purpose}.md` (e.g., `tester.md`)

### Frontmatter Requirements

```yaml
---
description: "Required - brief description"
category: "Required - category name"
type: "Required - always 'agent'"
tags: ["Optional - for discovery"]
dependencies: ["Optional - e.g., 'subagent:tester'"]
---
```

---

## Common Patterns

### Delegation to Subagents

```markdown
When task requires testing:
1. Implement feature
2. Delegate to TestEngineer for test creation
```

### Context Loading

```markdown
Before implementing:
1. Load core/standards/code-quality.md
2. Load category-specific context if available
3. Apply standards to implementation
```

### Approval Gates

```markdown
Before execution:
1. Present plan to user
2. Request approval
3. Execute incrementally
```

---

## Related Files

- **Adding agents**: `guides/adding-agent.md`
- **Testing agents**: `guides/testing-agent.md`
- **Category system**: `core-concepts/categories.md`
- **File locations**: `lookup/file-locations.md`
- **Claude Code subagents**: `../to-be-consumed/claude-code-docs/create-subagents.md`
- **Claude Code skills**: `../to-be-consumed/claude-code-docs/agent-skills.md`
- **Claude Code hooks**: `../to-be-consumed/claude-code-docs/hooks.md`
- **Claude Code plugins**: `../to-be-consumed/claude-code-docs/plugins.md`

---

**Last Updated**: 2026-01-13  
**Version**: 0.5.1
