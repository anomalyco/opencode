<!-- Context: openagents-repo/registry | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Core Concept: Registry System

**Purpose**: Understanding how component tracking and distribution works  
**Priority**: CRITICAL - Load this before working with registry

---

## What Is the Registry?

The registry is a centralized catalog (`registry.json`) that tracks all components in OpenAgents Control:
- **Agents** - AI agent prompts
- **Subagents** - Delegated specialists
- **Commands** - Slash commands
- **Tools** - Custom tools
- **Contexts** - Context files

**Location**: `registry.json` (root directory)

---

## Registry Schema

### Top-Level Structure

```json
{
  "version": "0.5.0",
  "schema_version": "2.0.0",
  "components": {
    "agents": [...],
    "subagents": [...],
    "commands": [...],
    "tools": [...],
    "contexts": [...]
  },
  "profiles": {
    "essential": {...},
    "developer": {...},
    "business": {...}
  }
}
```

### Component Entry

```json
{
  "id": "frontend-specialist",
  "name": "Frontend Specialist",
  "type": "agent",
  "path": ".opencode/agent/subagents/development/frontend-specialist.md",
  "description": "Expert in React, Vue, and modern CSS",
  "category": "development",
  "tags": ["react", "vue", "css", "frontend"],
  "dependencies": ["subagent:tester"],
  "version": "0.5.0"
}
```

**Fields**:
- `id`: Unique identifier (kebab-case)
- `name`: Display name
- `type`: Component type (agent, subagent, command, tool, context)
- `path`: File path relative to repo root
- `description`: Brief description
- `category`: Category name (for agents)
- `tags`: Optional tags for discovery
- `dependencies`: Optional dependencies
- `version`: Version when added/updated

---

## Auto-Detect System

The auto-detect system scans `.opencode/` and automatically updates the registry.

### How It Works

```
1. Scan .opencode/ directory
2. Find all .md files with frontmatter
3. Extract metadata (description, category, type, tags)
4. Validate paths exist
5. Generate component entries
6. Update registry.json
```

### Running Auto-Detect

```bash
# Dry run (see what would be added)
./scripts/registry/auto-detect-components.sh --dry-run

# Actually add components
./scripts/registry/auto-detect-components.sh --auto-add

# Force update existing entries
./scripts/registry/auto-detect-components.sh --auto-add --force
```

### What Gets Detected

✅ **Agents** - `.opencode/agent/{category}/*.md`  
✅ **Subagents** - `.opencode/agent/subagents/**/*.md`  
✅ **Commands** - `.opencode/command/**/*.md`  
✅ **Tools** - `.opencode/tool/**/index.ts`  
✅ **Contexts** - `/Users/apple/.config/opencode/context/**/*.md`  

### Frontmatter Requirements

For auto-detect to work, files must have frontmatter:

```yaml
---
description: "Brief description"
category: "category-name"  # For agents
type: "agent"              # Or subagent, command, tool, context
tags: ["tag1", "tag2"]     # Optional
---
```

---

## Validation

### Registry Validation

```bash
# Validate registry
./scripts/registry/validate-registry.sh

# Verbose output
./scripts/registry/validate-registry.sh -v
```

### What Gets Validated

✅ **Schema** - Correct JSON structure  
✅ **Paths** - All paths exist  
✅ **IDs** - Unique IDs  
✅ **Categories** - Valid categories  
✅ **Dependencies** - Dependencies exist  
✅ **Versions** - Version consistency  

### Validation Errors

```bash
# Example errors
ERROR: Path does not exist: (example: .opencode/agent/core/missing.md)
ERROR: Duplicate ID: frontend-specialist
ERROR: Invalid category: invalid-category
ERROR: Missing dependency: subagent:nonexistent
```

---

## Agents vs Subagents

**Main Agents** (2 in Developer profile):
- openagent: Universal coordination agent
- opencoder: Complex coding and architecture

**Specialist Subagents** (8 in Developer profile):
- frontend-specialist: React, Vue, CSS architecture
- devops-specialist: CI/CD, infrastructure, deployment

- task-manager: Feature breakdown and planning
- documentation: Create and update docs
- coder-agent: Execute coding subtasks
- reviewer: Code review and security
- tester: Write unit and integration tests
- build-agent: Type checking and validation
- image-specialist: Generate and edit images

**Commands** (7 in Developer profile):
- analyze-patterns: Analyze codebase for patterns
- commit, test, context, clean, optimize, validate-repo

---

## Component Profiles

Profiles are pre-configured component bundles for quick installation.

### Available Profiles

#### Essential Profile
**Purpose**: Minimal setup for basic usage

**Includes**:
- Core agents (openagent, opencoder)
- Essential commands (commit, test)
- Core context files

```json
"essential": {
  "description": "Minimal setup for basic usage",
  "components": [
    "agent:openagent",
    "agent:opencoder",
    "command:commit",
    "command:test"
  ]
}
```

---

#### Developer Profile
**Purpose**: Full development setup

**Includes**:
- All core agents
- Development specialists
- All subagents
- Dev commands
- Dev context files

```json
"developer": {
  "description": "Full development setup",
  "components": [
    "agent:*",
    "subagent:*",
    "command:*",
    "context:core/*",
    "context:development/*"
  ]
}
```

---

#### Business Profile
**Purpose**: Content and product focus

**Includes**:
- Core agents
- Content specialists
- Product specialists
- Content context files

```json
"business": {
  "description": "Content and product focus",
  "components": [
    "agent:openagent",
    "agent:copywriter",
    "agent:technical-writer",
    "context:core/*",
    "context:content/*"
  ]
}
```

---

## Install System

The install system uses the registry to distribute components.

### Installation Flow

```
1. User runs install.sh
2. Check for local registry.json (development mode)
3. If not local, fetch from GitHub (production mode)
4. Parse registry.json
5. Show component selection UI
6. Resolve dependencies
7. Download components from GitHub
8. Install to .opencode/
9. Handle collisions (skip/overwrite/backup)
```

### Local Registry (Development)

```bash
# Test with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list

# Install with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh developer
```

### Remote Registry (Production)

```bash
# Install from GitHub
./install.sh developer

# List available components
./install.sh --list
```

---

## Dependency Resolution

### Dependency Format

```json
"dependencies": [
  "subagent:tester",
  "context:core/standards/code"
]
```

### Resolution Rules

1. Parse dependency string (`type:id`)
2. Find component in registry
3. Check if already installed
4. Add to install queue
5. Recursively resolve dependencies
6. Install in dependency order

### Example

```
User installs: frontend-specialist
  ↓
Depends on: subagent:tester
  ↓
Depends on: context:core/standards/tests
  ↓
Install order:
  1. context:core/standards/tests
  2. subagent:tester
  3. frontend-specialist
```

---

## Collision Handling

When installing components that already exist:

### Collision Strategies

1. **Skip** - Keep existing file
2. **Overwrite** - Replace with new file
3. **Backup** - Backup existing, install new

### Interactive Mode

```bash
File exists: .opencode/agent/core/openagent.md
[S]kip, [O]verwrite, [B]ackup, [A]ll skip, [F]orce all? 
```

### Non-Interactive Mode

```bash
# Skip all collisions
./install.sh developer --skip-existing

# Overwrite all collisions
./install.sh developer --force

# Backup all collisions
./install.sh developer --backup
```

---

## Version Management

### Version Fields

- **Registry version**: Overall registry version (e.g., "0.5.0")
- **Schema version**: Registry schema version (e.g., "2.0.0")
- **Component version**: When component was added/updated

### Version Consistency

```bash
# Check version consistency
cat VERSION
cat package.json | jq '.version'
cat registry.json | jq '.version'

# All should match
```

### Updating Versions

```bash
# Bump version
echo "0.X.Y" > VERSION
jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json
jq '.version = "0.X.Y"' registry.json > tmp && mv tmp registry.json
```

---

## CI/CD Integration

### GitHub Workflows

#### Validate Registry (PR Checks)

```yaml
# .github/workflows/validate-registry.yml
- name: Validate Registry
  run: ./scripts/registry/validate-registry.sh
```

#### Auto-Update Registry (Post-Merge)

```yaml
# .github/workflows/update-registry.yml
- name: Update Registry
  run: ./scripts/registry/auto-detect-components.sh --auto-add
```

#### Version Bump (On Release)

```yaml
# .github/workflows/version-bump.yml
- name: Bump Version
  run: ./scripts/versioning/bump-version.sh
```

---

## Best Practices

### Adding Components

✅ **Add frontmatter** - Required for auto-detect  
✅ **Run auto-detect** - Don't manually edit registry  
✅ **Validate** - Always validate after changes  
✅ **Test locally** - Use local registry for testing  

### Maintaining Registry

✅ **Auto-detect first** - Let scripts handle updates  
✅ **Validate often** - Catch issues early  
✅ **Version consistency** - Keep versions in sync  
✅ **CI validation** - Automate validation in CI  

### Dependencies

✅ **Explicit dependencies** - List all dependencies  
✅ **Test resolution** - Verify dependencies resolve  
✅ **Avoid cycles** - No circular dependencies  

---

## Common Issues

### Path Not Found

**Problem**: Registry references non-existent path  
**Solution**: Run auto-detect or fix path manually

### Duplicate ID

**Problem**: Two components with same ID  
**Solution**: Rename one component

### Invalid Category

**Problem**: Agent has invalid category  
**Solution**: Use valid category (core, development, content, data, product, learning)

### Missing Dependency

**Problem**: Dependency doesn't exist in registry  
**Solution**: Add dependency or remove reference

### Version Mismatch

**Problem**: VERSION, package.json, registry.json don't match  
**Solution**: Update all version files to match

---

## Related Files

- **Updating registry**: `guides/updating-registry.md`
- **Adding agents**: `guides/adding-agent.md`
- **Categories**: `core-concepts/categories.md`

---

**Last Updated**: 2025-01-28  
**Version**: 0.5.2
