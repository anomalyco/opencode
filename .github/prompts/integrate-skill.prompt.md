---
description: "Trellis Copilot prompt: Integrate Claude Skill into Project Guidelines"
---

# Integrate Claude Skill into Project Guidelines

Adapt and integrate a Claude global skill into your project's development guidelines (not directly into project code).

## Usage

```
/ <skill-name>
```

**Examples**:
```
/ frontend-design
/ mcp-builder
```

## Core Principle

> [!] **Important**: The goal of skill integration is to update **development guidelines**, not to generate project code directly.
>
> - Guidelines content -> Write to `.trellis/spec/{target}/doc.md`
> - Code examples -> Place in `.trellis/spec/{target}/examples/skills/<skill-name>/`
> - Example files -> Use `.template` suffix (e.g., `component.tsx.template`) to avoid IDE errors
>
> Where `{target}` is `frontend` or `backend`, determined by skill type.

## Execution Steps

### 1. Read Skill Content

```bash
openskills read <skill-name>
```

If the skill doesn't exist, prompt user to check available skills:
```bash
# Available skills are listed in AGENTS.md under <available_skills>
```

### 2. Determine Integration Target

Based on skill type, determine which guidelines to update:

| Skill Category | Integration Target |
|----------------|-------------------|
| UI/Frontend (`frontend-design`, `web-artifacts-builder`) | `.trellis/spec/frontend/` |
| Backend/API (`mcp-builder`) | `.trellis/spec/backend/` |
| Documentation (`doc-coauthoring`, `docx`, `pdf`) | `.trellis/` or create dedicated guidelines |
| Testing (`webapp-testing`) | `.trellis/spec/frontend/` (E2E) |

### 3. Analyze Skill Content

Extract from the skill:
- **Core concepts**: How the skill works and key concepts
- **Best practices**: Recommended approaches
- **Code patterns**: Reusable code templates
- **Caveats**: Common issues and solutions

### 4. Execute Integration

#### 4.1 Update Guidelines Document

Add a new section to the corresponding `doc.md`:

```markdown
@@@section:skill-<skill-name>
## # <Skill Name> Integration Guide

### Overview
[Core functionality and use cases of the skill]

### Project Adaptation
[How to use this skill in the current project]

### Usage Steps
1. [Step 1]
2. [Step 2]

### Caveats
- [Project-specific constraints]
- [Differences from default behavior]

### Reference Examples
See `examples/skills/<skill-name>/`

@@@/section:skill-<skill-name>
```

#### 4.2 Create Examples Directory (if code examples exist)

```bash
# Directory structure ({target} = frontend or backend)
.trellis/spec/{target}/
|-- doc.md                      # Add skill-related section
|-- index.md                    # Update index
+-- examples/
    +-- skills/
        +-- <skill-name>/
            |-- README.md               # Example documentation
            |-- example-1.ts.template   # Code example (use .template suffix)
            +-- example-2.tsx.template
```

**File naming conventions**:
- Code files: `<name>.<ext>.template` (e.g., `component.tsx.template`)
- Config files: `<name>.config.template` (e.g., `tailwind.config.template`)
- Documentation: `README.md` (normal suffix)

#### 4.3 Update Index File

Add to the Quick Navigation table in `index.md`:

```markdown
| <Skill-related task> | <Section name> | `skill-<skill-name>` |
```

### 5. Generate Integration Report

---

## Skill Integration Report: `<skill-name>`

### # Overview
- **Skill description**: [Functionality description]
- **Integration target**: `.trellis/spec/{target}/`

### # Tech Stack Compatibility

| Skill Requirement | Project Status | Compatibility |
|-------------------|----------------|---------------|
| [Tech 1] | [Project tech] | [OK]/[!]/[X] |

### # Integration Locations

| Type | Path |
|------|------|
| Guidelines doc | `.trellis/spec/{target}/doc.md` (section: `skill-<name>`) |
| Code examples | `.trellis/spec/{target}/examples/skills/<name>/` |
| Index update | `.trellis/spec/{target}/index.md` |

> `{target}` = `frontend` or `backend`

### # Dependencies (if needed)

```bash
# Install required dependencies (adjust for your package manager)
npm install <package>
# or
pnpm add <package>
# or
yarn add <package>
```

### [OK] Completed Changes

- [ ] Added `@@@section:skill-<name>` section to `doc.md`
- [ ] Added index entry to `index.md`
- [ ] Created example files in `examples/skills/<name>/`
- [ ] Example files use `.template` suffix

### # Related Guidelines

- [Existing related section IDs]

---

## 6. Optional: Create Usage Command

If this skill is frequently used, create a shortcut command:

```bash
/ use-<skill-name> Use <skill-name> skill following project guidelines
```

## Common Skill Integration Reference

| Skill | Integration Target | Examples Directory |
|-------|-------------------|-------------------|
| `frontend-design` | `frontend` | `examples/skills/frontend-design/` |
| `mcp-builder` | `backend` | `examples/skills/mcp-builder/` |
| `webapp-testing` | `frontend` | `examples/skills/webapp-testing/` |
| `doc-coauthoring` | `.trellis/` | N/A (documentation workflow only) |

## Example: Integrating `mcp-builder` Skill

### Directory Structure

```
.trellis/spec/backend/
|-- doc.md                           # Add MCP section
|-- index.md                         # Add index entry
+-- examples/
    +-- skills/
        +-- mcp-builder/
            |-- README.md
            |-- server.ts.template
            |-- tools.ts.template
            +-- types.ts.template
```

### New Section in doc.md

```markdown
@@@section:skill-mcp-builder
## # MCP Server Development Guide

### Overview
Create LLM-callable tool services using MCP (Model Context Protocol).

### Project Adaptation
- Place services in a dedicated directory
- Follow existing TypeScript and type definition conventions
- Use project's logging system

### Reference Examples
See `examples/skills/mcp-builder/`

@@@/section:skill-mcp-builder
```
