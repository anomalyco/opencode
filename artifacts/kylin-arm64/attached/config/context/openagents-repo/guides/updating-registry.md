<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Updating Registry

**Prerequisites**: Load `core-concepts/registry.md` first  
**Purpose**: How to update the component registry

---

## Quick Commands

```bash
# Auto-detect and add new components
./scripts/registry/auto-detect-components.sh --auto-add

# Validate registry
./scripts/registry/validate-registry.sh

# Dry run (see what would change)
./scripts/registry/auto-detect-components.sh --dry-run
```

---

## When to Update Registry

Update the registry when you:
- ✅ Add a new agent
- ✅ Add a new command
- ✅ Add a new tool
- ✅ Add a new context file
- ✅ Change component metadata
- ✅ Move or rename components

---

## Auto-Detect (Recommended)

### Step 1: Dry Run

```bash
# See what would be added/updated
./scripts/registry/auto-detect-components.sh --dry-run
```

**Output**:
```
Scanning .opencode/ for components...

Would add:
  - agent: development/api-specialist
  - context: development/api-patterns.md

Would update:
  - agent: core/openagent (description changed)
```

### Step 2: Apply Changes

```bash
# Actually update registry
./scripts/registry/auto-detect-components.sh --auto-add
```

### Step 3: Validate

```bash
# Validate registry
./scripts/registry/validate-registry.sh
```

---

## Frontmatter Metadata (Auto-Extracted)

The auto-detect script automatically extracts `tags` and `dependencies` from component frontmatter. This is the **recommended way** to add metadata.

### Supported Formats

**Multi-line arrays** (recommended for readability):
```yaml
---
description: Your component description
tags:
  - tag1
  - tag2
  - tag3
dependencies:
  - subagent:coder-agent
  - context:core/standards/code
  - command:context
---
```

**Inline arrays** (compact format):
```yaml
---
description: Your component description
tags: [tag1, tag2, tag3]
dependencies: [subagent:coder-agent, context:core/standards/code]
---
```

### Component-Specific Examples

**Command** (`.opencode/command/your-command.md`):
```yaml
---
description: Brief description of what this command does
tags:
  - category
  - feature
  - use-case
dependencies:
  - subagent:context-organizer
  - subagent:contextscout
---
```

**Subagent** (`.opencode/agent/subagents/category/your-agent.md`):
```yaml
---
id: your-agent
name: Your Agent Name
description: What this agent does
category: specialist
type: specialist
tags:
  - domain
  - capability
dependencies:
  - subagent:coder-agent
  - context:core/standards/code
---
```

**Context** (`/Users/apple/.config/opencode/context/category/your-context.md`):
```yaml
---
description: What knowledge this context provides
tags:
  - domain
  - topic
dependencies:
  - context:core/standards/code
---
```

### Dependency Format

Dependencies use the format: `type:id`

**Valid types**:
- `subagent:` - References a subagent (e.g., `subagent:coder-agent`)
- `command:` - References a command (e.g., `command:context`)
- `context:` - References a context file (e.g., `context:core/standards/code`)
- `agent:` - References a main agent (e.g., `agent:openagent`)

**Examples**:
```yaml
dependencies:
  - subagent:coder-agent          # Depends on coder-agent subagent
  - context:core/standards/code   # Requires code standards context
  - command:context               # Uses context command
```

### How It Works

1. **Create component** with frontmatter (tags + dependencies)
2. **Run auto-detect**: `./scripts/registry/auto-detect-components.sh --dry-run`
3. **Verify extraction**: Check that tags/dependencies appear in output
4. **Apply changes**: `./scripts/registry/auto-detect-components.sh --auto-add`
5. **Validate**: `./scripts/registry/validate-registry.sh`

The script automatically:
- ✅ Extracts `description`, `tags`, `dependencies` from frontmatter
- ✅ Handles both inline and multi-line array formats
- ✅ Converts to proper JSON arrays in registry
- ✅ Validates dependency references exist

---

## Manual Updates (Not Recommended)

Only edit `registry.json` manually if auto-detect doesn't work.

**Prefer frontmatter**: Add tags/dependencies to component frontmatter instead of editing registry directly.

### Adding Component Manually

```json
{
  "id": "agent-name",
  "name": "Agent Name",
  "type": "agent",
  "path": ".opencode/agent/category/agent-name.md",
  "description": "Brief description",
  "category": "category",
  "tags": ["tag1", "tag2"],
  "dependencies": [],
  "version": "0.5.0"
}
```

### Validate After Manual Edit

```bash
./scripts/registry/validate-registry.sh
```

---

## Validation

### What Gets Validated

✅ **Schema** - Correct JSON structure  
✅ **Paths** - All paths exist  
✅ **IDs** - Unique IDs  
✅ **Categories** - Valid categories  
✅ **Dependencies** - Dependencies exist  

### Validation Errors

```bash
# Example errors
ERROR: Path does not exist: (example: .opencode/agent/core/missing.md)
ERROR: Duplicate ID: frontend-specialist
ERROR: Invalid category: invalid-category
ERROR: Missing dependency: subagent:nonexistent
```

### Fixing Errors

1. **Path not found**: Fix path or remove entry
2. **Duplicate ID**: Rename one component
3. **Invalid category**: Use valid category
4. **Missing dependency**: Add dependency or remove reference

---

## Testing Registry Changes

### Test Locally

```bash
# Test with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list

# Try installing a component
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --component agent:your-agent
```

### Verify Component Appears

```bash
# List all agents
cat registry.json | jq '.components.agents[].id'

# Check specific component
cat registry.json | jq '.components.agents[] | select(.id == "your-agent")'
```

---

## Common Tasks

### Add New Component to Registry

```bash
# 1. Create component file with frontmatter (including tags/dependencies)
# 2. Run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add

# 3. Validate
./scripts/registry/validate-registry.sh
```

**Example**: Adding a new command with tags/dependencies:

```bash
# 1. Create .opencode/command/my-command.md with frontmatter:
cat > .opencode/command/my-command.md << 'EOF'
---
description: My custom command description
tags: [automation, workflow]
dependencies: [subagent:coder-agent]
---

# My Command
...
EOF

# 2. Auto-detect extracts metadata
./scripts/registry/auto-detect-components.sh --dry-run

# 3. Apply changes
./scripts/registry/auto-detect-components.sh --auto-add

# 4. Validate
./scripts/registry/validate-registry.sh
```

### Update Component Metadata

```bash
# 1. Update frontmatter in component file (tags, dependencies, description)
# 2. Run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add

# 3. Validate
./scripts/registry/validate-registry.sh
```

**Example**: Adding tags to existing component:

```bash
# 1. Edit .opencode/command/existing-command.md frontmatter:
# Add or update:
#   tags: [new-tag, another-tag]
#   dependencies: [subagent:new-dependency]

# 2. Auto-detect picks up changes
./scripts/registry/auto-detect-components.sh --dry-run

# 3. Apply
./scripts/registry/auto-detect-components.sh --auto-add
```

### Remove Component

```bash
# 1. Delete component file
# 2. Run auto-detect (will remove from registry)
./scripts/registry/auto-detect-components.sh --auto-add

# 3. Validate
./scripts/registry/validate-registry.sh
```

---

## CI/CD Integration

### Automatic Validation

Registry is validated on:
- Pull requests (`.github/workflows/validate-registry.yml`)
- Merges to main
- Release tags

### Auto-Update on Merge

Registry can be auto-updated after merge:
```yaml
# .github/workflows/update-registry.yml
- name: Update Registry
  run: ./scripts/registry/auto-detect-components.sh --auto-add
```

---

## Best Practices

✅ **Use frontmatter** - Add tags/dependencies to component files, not registry  
✅ **Use auto-detect** - Don't manually edit registry  
✅ **Validate often** - Catch issues early  
✅ **Test locally** - Use local registry for testing  
✅ **Dry run first** - See changes before applying  
✅ **Version consistency** - Keep versions in sync  
✅ **Multi-line arrays** - More readable than inline format  
✅ **Meaningful tags** - Use descriptive, searchable tags  
✅ **Declare dependencies** - Helps with component discovery and validation  

---

## Related Files

- **Registry concepts**: `core-concepts/registry.md`
- **Adding agents**: `guides/adding-agent.md`
- **Debugging**: `guides/debugging.md`

---

## Troubleshooting

### Tags/Dependencies Not Extracted

**Problem**: Auto-detect doesn't extract tags or dependencies from frontmatter.

**Solutions**:
1. **Check frontmatter format**:
   - Must be at top of file
   - Must start/end with `---`
   - Must use valid YAML syntax

2. **Verify array format**:
   ```yaml
   # ✅ Valid formats
   tags: [tag1, tag2]
   tags:
     - tag1
     - tag2
   
   # ❌ Invalid
   tags: tag1, tag2  # Missing brackets
   ```

3. **Check dependency format**:
   ```yaml
   # ✅ Valid
   dependencies: [subagent:coder-agent, context:core/standards/code]
   
   # ❌ Invalid
   dependencies: [coder-agent]  # Missing type prefix
   ```

4. **Run dry-run to debug**:
   ```bash
   ./scripts/registry/auto-detect-components.sh --dry-run
   # Check output shows extracted tags/dependencies
   ```

### Dependency Validation Errors

**Problem**: Validation fails with "Missing dependency" error.

**Solution**: Ensure referenced component exists in registry:
```bash
# Check if dependency exists
jq '.components.subagents[] | select(.id == "coder-agent")' registry.json

# If missing, add the dependency component first
```

### Context Not Found (Aliases)

**Problem**: Error `Could not find path for context:old-name` even though file exists.

**Cause**: The context file might have been renamed or the ID in registry doesn't match the requested name.

**Solution**: Add an alias to the component in `registry.json`.

1. Find the component in `registry.json`
2. Add `"aliases": ["old-name", "alternative-name"]`
3. Validate registry

---

## Managing Aliases

Aliases allow components to be referenced by multiple names. This is useful for:
- Backward compatibility (renamed files)
- Shorthand references
- Alternative naming conventions

### Adding Aliases

Currently, aliases must be added **manually** to `registry.json` (auto-detect does not yet support them).

```json
{
  "id": "session-management",
  "name": "Session Management",
  "type": "context",
  "path": "/Users/apple/.config/opencode/context/core/workflows/session-management.md",
  "aliases": [
    "workflows-sessions",
    "sessions"
  ],
  ...
}
```

**Note**: Always validate the registry after manual edits:
```bash
./scripts/registry/validate-registry.sh
```

---

**Last Updated**: 2025-01-06  
**Version**: 2.0.0
