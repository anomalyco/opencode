<!-- Context: openagents-repo/core-concepts/agent-metadata | Priority: critical | Version: 1.0 | Updated: 2026-01-31 -->
# Core Concept: Agent Metadata System

**Purpose**: Understanding the centralized metadata system for OpenAgents Control  
**Priority**: CRITICAL - Load this before working with agent metadata

---

## What Is the Agent Metadata System?

The agent metadata system separates **OpenCode-compliant agent configuration** from **OpenAgents Control registry metadata**. This solves the problem of OpenCode validation errors when agents contain fields that aren't part of the OpenCode agent schema.

**Key Principle**: Agent frontmatter contains ONLY valid OpenCode fields. All other metadata lives in a centralized file.

---

## The Problem We Solved

### Before (Validation Errors)

Agent frontmatter contained fields that OpenCode doesn't recognize:

```yaml
---
id: opencoder                    # ❌ Not valid OpenCode field
name: OpenCoder                  # ❌ Not valid OpenCode field
category: core                   # ❌ Not valid OpenCode field
type: core                       # ❌ Not valid OpenCode field
version: 1.0.0                   # ❌ Not valid OpenCode field
author: opencode                 # ❌ Not valid OpenCode field
tags: [development, coding]      # ❌ Not valid OpenCode field
dependencies: []              # ❌ Not valid OpenCode field
description: "..."               # ✅ Valid OpenCode field
mode: primary                    # ✅ Valid OpenCode field
temperature: 0.1                 # ✅ Valid OpenCode field
tools: {...}                     # ✅ Valid OpenCode field
permission: {...}                # ✅ Valid OpenCode field
---
```

**Result**: OpenCode validation errors:
```
Extra inputs are not permitted, field: 'id', value: 'opencoder'
Extra inputs are not permitted, field: 'category', value: 'core'
Extra inputs are not permitted, field: 'type', value: 'core'
... (9 validation errors)
```

### After (Clean Separation)

**Agent frontmatter** (`.opencode/agent/core/opencoder.md`):
```yaml
---
# Metadata stored in: .opencode/config/agent-metadata.json
description: "Orchestration agent for complex coding, architecture, and multi-file refactoring"
mode: primary
temperature: 0.1
tools: {...}
permission: {...}
---
```

**Centralized metadata** (`.opencode/config/agent-metadata.json`):
```json
{
  "agents": {
    "opencoder": {
      "id": "opencoder",
      "name": "OpenCoder",
      "category": "core",
      "type": "agent",
      "version": "1.0.0",
      "author": "opencode",
      "tags": ["development", "coding", "implementation"],
      "dependencies": [
        "subagent:documentation",
        "subagent:coder-agent",
        "context:core/standards/code"
      ]
    }
  }
}
```

**Result**: ✅ No validation errors, clean separation of concerns

---

## Valid OpenCode Agent Fields

Based on [OpenCode documentation](https://opencode.ai/docs/agents/), these are the ONLY valid frontmatter fields:

### Required Fields
- `description` - When to use this agent (required)
- `mode` - Agent type: `primary`, `subagent`, or `all` (defaults to `all`)

### Optional Fields
- `model` - Model override (e.g., `anthropic/claude-sonnet-4-20250514`)
- `temperature` - Response randomness (0.0-1.0)
- `maxSteps` - Max agentic iterations
- `disable` - Set to `true` to disable agent
- `prompt` - Custom prompt file path (e.g., `{file:./prompts/build.txt}`)
- `hidden` - Hide from @ autocomplete (subagents only)
- `tools` - Tool access configuration
- `permission` - Permission rules for tools (v1.1.1+, replaces deprecated `permissions`)

### Example Valid Frontmatter

```yaml
---
description: "Code review agent with security focus"
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
tools:
  read: true
  grep: true
  glob: true
  write: false
  edit: false
permission:  # v1.1.1+ (singular, not plural)
  bash:
    "*": ask
    "git *": allow
  edit: deny
---
```

---

## Centralized Metadata File

**Location**: `.opencode/config/agent-metadata.json`

### Schema

```json
{
  "$schema": "https://opencode.ai/schemas/agent-metadata.json",
  "schema_version": "1.0.0",
  "description": "Centralized metadata for OpenAgents Control agents",
  "agents": {
    "agent-id": {
      "id": "agent-id",
      "name": "Agent Name",
      "category": "core|development|content|data|product|learning|meta",
      "type": "agent|subagent",
      "version": "1.0.0",
      "author": "opencode",
      "tags": ["tag1", "tag2"],
      "dependencies": [
        "subagent:subagent-id",
        "context:path/to/context"
      ]
    }
  },
  "defaults": {
    "agent": {
      "version": "1.0.0",
      "author": "opencode",
      "type": "agent",
      "tags": []
    },
    "subagent": {
      "version": "1.0.0",
      "author": "opencode",
      "type": "subagent",
      "tags": []
    }
  }
}
```

### Metadata Fields

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| `id` | Yes | Unique identifier (kebab-case) | `"opencoder"` |
| `name` | Yes | Display name | `"OpenCoder"` |
| `category` | Yes | Agent category | `"core"` |
| `type` | Yes | Component type | `"agent"` or `"subagent"` |
| `version` | Yes | Version number | `"1.0.0"` |
| `author` | Yes | Author identifier | `"opencode"` |
| `tags` | No | Discovery tags | `["development", "coding"]` |
| `dependencies` | No | Component dependencies | `["subagent:tester"]` |

---

## How It Works

### 1. Agent Creation

When creating a new agent:

**Step 1**: Create agent file with ONLY valid OpenCode fields

```bash
# Create agent file
touch .opencode/agent/category/my-agent.md
```

```yaml
---
description: "My agent description"
mode: subagent
temperature: 0.2
tools:
  read: true
  write: true
---

# Agent prompt content here
```

**Step 2**: Add metadata to `.opencode/config/agent-metadata.json`

```json
{
  "agents": {
    "my-agent": {
      "id": "my-agent",
      "name": "My Agent",
      "category": "development",
      "type": "subagent",
      "version": "1.0.0",
      "author": "opencode",
      "tags": ["custom", "helper"],
      "dependencies": ["context:core/standards/code"]
    }
  }
}
```

**Step 3**: Run auto-detect to update registry

```bash
./scripts/registry/auto-detect-components.sh --auto-add
```

The auto-detect script:
1. Reads frontmatter from agent file (description, mode, etc.)
2. Reads metadata from `agent-metadata.json` (id, name, tags, dependencies)
3. Merges both into registry.json entry

### 2. Auto-Detect Integration

The auto-detect script (`scripts/registry/auto-detect-components.sh`) has been enhanced to:

1. **Extract frontmatter** - Read description from agent file
2. **Lookup metadata** - Check `agent-metadata.json` for agent ID
3. **Merge data** - Combine frontmatter + metadata
4. **Update registry** - Write complete entry to registry.json

**Code snippet** (from auto-detect script):

```bash
# Check if agent-metadata.json exists and merge metadata from it
local metadata_file="$REPO_ROOT/.opencode/config/agent-metadata.json"
if [ -f "$metadata_file" ] && command -v jq &> /dev/null; then
    # Try to find metadata for this agent ID
    local metadata_entry
    metadata_entry=$(jq -r ".agents[\"$id\"] // empty" "$metadata_file" 2>/dev/null)
    
    if [ -n "$metadata_entry" ] && [ "$metadata_entry" != "null" ]; then
        # Merge name, tags, dependencies from metadata
        # ...
    fi
fi
```

### 3. Registry Output

The registry.json entry contains merged data:

```json
{
  "id": "opencoder",
  "name": "OpenCoder",
  "type": "agent",
  "path": ".opencode/agent/core/opencoder.md",
  "description": "Orchestration agent for complex coding...",
  "category": "core",
  "tags": ["development", "coding", "implementation"],
  "dependencies": [
    "subagent:documentation",
    "subagent:coder-agent",
    "context:core/standards/code"
  ]
}
```

---

## Workflow

### Adding a New Agent

```bash
# 1. Create agent file (OpenCode-compliant frontmatter only)
vim .opencode/agent/category/my-agent.md

# 2. Add metadata entry
vim .opencode/config/agent-metadata.json

# 3. Update registry
./scripts/registry/auto-detect-components.sh --auto-add

# 4. Validate
./scripts/registry/validate-registry.sh
```

### Updating Agent Metadata

**To update OpenCode configuration** (tools, permissions, temperature):
```bash
# Edit agent file frontmatter
vim .opencode/agent/category/my-agent.md
```

**To update registry metadata** (tags, dependencies, version):
```bash
# Edit metadata file
vim .opencode/config/agent-metadata.json

# Re-run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add
```

### Updating Dependencies

**Add a dependency**:
```json
{
  "agents": {
    "my-agent": {
      "dependencies": [
        "subagent:tester",
        "context:core/standards/code",
        "subagent:new-dependency"  // ← Add here
      ]
    }
  }
}
```

Then run:
```bash
./scripts/registry/auto-detect-components.sh --auto-add
./scripts/registry/validate-registry.sh
```

---

## Benefits

### ✅ OpenCode Compliance
- Agent frontmatter contains ONLY valid OpenCode fields
- No validation errors from OpenCode
- Agents work correctly with OpenCode CLI

### ✅ Registry Compatibility
- Registry still has all metadata (id, name, category, tags, dependencies)
- Auto-detect script merges frontmatter + metadata
- Backward compatible with existing tools

### ✅ Single Source of Truth
- Metadata centralized in one file
- Easy to update dependencies across multiple agents
- Clear separation: OpenCode config vs. registry metadata

### ✅ Maintainability
- Update dependencies in one place
- Consistent metadata across all agents
- Easy to add new metadata fields

### ✅ Validation
- OpenCode validates frontmatter (no extra fields)
- Registry validator checks dependencies exist
- Clear error messages when metadata is missing

---

## Migration Guide

### Migrating from permissions (plural) to permission (singular)

**OpenCode v1.1.1+ Change**: The field name changed from `permissions:` (plural) to `permission:` (singular).

**Before** (deprecated):
```yaml
permissions:
  bash:
    "*": "deny"
```

**After** (v1.1.1+):
```yaml
permission:
  bash:
    "*": "deny"
```

**Migration Steps**:
1. Find all agents using `permissions:` (plural)
   ```bash
   grep -r "^permissions:" .opencode/agent/
   ```

2. Replace with `permission:` (singular) in each file

3. Verify no validation errors:
   ```bash
   opencode agent validate
   ```

### Migrating Existing Agents

**Step 1**: Identify agents with extra fields

```bash
# Find agents with invalid OpenCode fields
grep -r "^id:\|^name:\|^category:\|^type:\|^version:\|^author:\|^tags:\|^dependencies:" .opencode/agent/
```

**Step 2**: Extract metadata to `agent-metadata.json`

For each agent:
1. Copy `id`, `name`, `category`, `type`, `version`, `author`, `tags`, `dependencies` to metadata file
2. Remove these fields from agent frontmatter
3. Keep ONLY valid OpenCode fields in frontmatter

**Step 3**: Update registry

```bash
# Remove old entries
jq 'del(.components.agents[] | select(.id == "agent-id"))' registry.json > tmp.json && mv tmp.json registry.json

# Re-add with new metadata
./scripts/registry/auto-detect-components.sh --auto-add
```

**Step 4**: Validate

```bash
./scripts/registry/validate-registry.sh
```

---

## Best Practices

### Agent Frontmatter

✅ **DO**:
- Keep frontmatter minimal (only OpenCode fields)
- Add comment pointing to metadata file
- Use consistent formatting

❌ **DON'T**:
- Add custom fields to frontmatter
- Duplicate metadata in both places
- Skip the metadata file

### Metadata File

✅ **DO**:
- Keep metadata file in version control
- Update metadata when adding/removing dependencies
- Use consistent naming (kebab-case for IDs)
- Document why dependencies exist

❌ **DON'T**:
- Forget to update metadata when creating agents
- Leave orphaned entries (agents that don't exist)
- Skip validation after updates

### Dependencies

✅ **DO**:
- Declare ALL dependencies (subagents, contexts)
- Use correct format: `type:id`
- Validate dependencies exist in registry

❌ **DON'T**:
- Reference components without declaring dependency
- Use invalid dependency formats
- Forget to update when dependencies change

---

## Troubleshooting

### OpenCode Validation Errors

**Problem**: `Extra inputs are not permitted, field: 'id'`

**Solution**: Remove invalid fields from agent frontmatter, add to metadata file

```bash
# 1. Edit agent file - remove id, name, category, type, version, author, tags, dependencies
vim .opencode/agent/category/agent.md

# 2. Add to metadata file
vim .opencode/config/agent-metadata.json

# 3. Update registry
./scripts/registry/auto-detect-components.sh --auto-add
```

### Missing Metadata

**Problem**: Auto-detect can't find metadata for agent

**Solution**: Add entry to `agent-metadata.json`

```json
{
  "agents": {
    "agent-id": {
      "id": "agent-id",
      "name": "Agent Name",
      "category": "core",
      "type": "agent",
      "version": "1.0.0",
      "author": "opencode",
      "tags": [],
      "dependencies": []
    }
  }
}
```

### Registry Out of Sync

**Problem**: Registry has old metadata

**Solution**: Remove entry and re-run auto-detect

```bash
# Remove old entry
jq 'del(.components.agents[] | select(.id == "agent-id"))' registry.json > tmp.json && mv tmp.json registry.json

# Re-add with current metadata
./scripts/registry/auto-detect-components.sh --auto-add
```

---

## Related Files

- **OpenCode Agent Docs**: https://opencode.ai/docs/agents/
- **Registry System**: `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/registry.md`
- **Adding Agents**: `/Users/apple/.config/opencode/context/openagents-repo/guides/adding-agent-basics.md`
- **Dependencies**: `/Users/apple/.config/opencode/context/openagents-repo/quality/registry-dependencies.md`

---

**Last Updated**: 2026-01-31  
**Version**: 1.0.0
