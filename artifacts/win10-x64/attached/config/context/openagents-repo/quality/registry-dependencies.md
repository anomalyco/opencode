---
description: Maintain registry quality through dependency validation and consistency checks
tags:
  - registry
  - quality
  - validation
  - dependencies
dependencies: []
---

<!-- Context: quality/registry-dependencies | Priority: high | Version: 1.0 | Updated: 2026-01-06 -->
# Registry Dependency Validation

**Purpose**: Maintain registry quality through dependency validation and consistency checks  
**Audience**: Contributors, maintainers, CI/CD processes

---

## Quick Reference

**Golden Rule**: All component dependencies must be declared in frontmatter and validated before commits.

**Critical Commands**:
```bash
# Check context file dependencies
/check-context-deps

# Auto-fix missing dependencies
/check-context-deps --fix

# Validate entire registry
./scripts/registry/validate-registry.sh

# Update registry after changes
./scripts/registry/auto-detect-components.sh --auto-add
```

---

## Dependency System

### Dependency Types

Components can depend on other components using the `type:id` format:

| Type | Format | Example | Description |
|------|--------|---------|-------------|
| **agent** | `agent:id` | `agent:opencoder` | Core agent profile |
| **subagent** | `subagent:id` | `subagent:coder-agent` | Delegatable subagent |
| **command** | `command:id` | `command:context` | Slash command |
| **tool** | `tool:id` | `tool:gemini` | External tool integration |
| **plugin** | `plugin:id` | `plugin:context` | Plugin component |
| **context** | `context:path` | `context:core/standards/code` | Context file |
| **config** | `config:id` | `config:defaults` | Configuration file |

### Declaring Dependencies

**In component frontmatter** (example):
```
id: opencoder
name: OpenCoder
description: Multi-language implementation agent
dependencies:
  - subagent:task-manager      # Can delegate to task-manager
  - subagent:coder-agent        # Can delegate to coder-agent
  - subagent:tester             # Can delegate to tester
  - context:core/standards/code # Requires code standards context
```

**Why declare dependencies?**
- ✅ **Validation**: Catch missing components before runtime
- ✅ **Documentation**: Clear visibility of what each component needs
- ✅ **Installation**: Installers can fetch all required dependencies
- ✅ **Dependency graphs**: Visualize component relationships
- ✅ **Breaking change detection**: Know what's affected by changes

---

## Context File Dependencies

### The Problem

Agents reference context files in their prompts but often don't declare them as dependencies:

```markdown
<!-- In agent prompt -->
BEFORE any code implementation, ALWAYS load:
- Code tasks → /Users/apple/.config/opencode/context/core/standards/code-quality.md (MANDATORY)
```

**Without dependency declaration**:
- ❌ No validation that context file exists
- ❌ Can't track which agents use which context files
- ❌ Breaking changes when context files are moved/deleted
- ❌ Installers don't know to fetch context files

### The Solution

**Declare context dependencies in frontmatter** (example):
```
id: opencoder
dependencies:
  - context:core/standards/code  # ← ADD THIS
```

**Use `/check-context-deps` to find missing declarations**:
```bash
# Analyze all agents
/check-context-deps

# Auto-fix missing context dependencies
/check-context-deps --fix
```

### Context Dependency Format

**Path normalization**:
```
File path:     /Users/apple/.config/opencode/context/core/standards/code-quality.md
Dependency:    context:core/standards/code
               ^^^^^^^ ^^^^^^^^^^^^^^^^^^^
               type    path (no .opencode/, no .md)
```

**Examples**:
```
dependencies:
  - context:core/standards/code           # /Users/apple/.config/opencode/context/core/standards/code-quality.md
  - context:core/standards/docs           # /Users/apple/.config/opencode/context/core/standards/documentation.md
  - context:core/workflows/delegation     # /Users/apple/.config/opencode/context/core/workflows/task-delegation-basics.md
  - context:openagents-repo/guides/adding-agent  # Project-specific context
```

---

## Validation Workflow

### Pre-Commit Checklist

Before committing changes to agents, commands, or context files:

1. **Check context dependencies**:
   ```bash
   /check-context-deps
   ```
   - Identifies agents using context files without declaring them
   - Reports unused context files
   - Validates context file paths

2. **Fix missing dependencies** (if needed):
   ```bash
   /check-context-deps --fix
   ```
   - Automatically adds missing `context:` dependencies to frontmatter
   - Preserves existing dependencies

3. **Update registry**:
   ```bash
   ./scripts/registry/auto-detect-components.sh --auto-add
   ```
   - Extracts dependencies from frontmatter
   - Updates registry.json

4. **Validate registry**:
   ```bash
   ./scripts/registry/validate-registry.sh
   ```
   - Checks all dependencies exist
   - Validates component paths
   - Reports missing dependencies

### Validation Tools

#### 1. `/check-context-deps` Command

**Purpose**: Analyze context file usage and validate dependencies

**What it checks**:
- ✅ Agents referencing context files in prompts
- ✅ Context dependencies declared in frontmatter
- ✅ Context files exist on disk
- ✅ Context files in registry
- ✅ Unused context files

**Usage**:
```bash
# Full analysis
/check-context-deps

# Specific agent
/check-context-deps opencoder

# Auto-fix
/check-context-deps --fix

# Verbose (show line numbers)
/check-context-deps --verbose
```

**Example output**:
```
# Context Dependency Analysis Report

## Summary
- Agents scanned: 25
- Context files referenced: 12
- Missing dependencies: 8
- Unused context files: 2

## Missing Dependencies

### opencoder
Uses but not declared:
- context:core/standards/code (referenced 3 times)
  - Line 64: "Code tasks → /Users/apple/.config/opencode/context/core/standards/code-quality.md"
  
Recommended fix:
dependencies:
  - context:core/standards/code
```

#### 2. `auto-detect-components.sh` Script

**Purpose**: Scan for new components and update registry

**Dependency validation**:
- Checks dependencies during component scanning
- Logs warnings for missing dependencies
- Non-blocking (warnings only)

**Usage**:
```bash
# See what would be added
./scripts/registry/auto-detect-components.sh --dry-run

# Add new components
./scripts/registry/auto-detect-components.sh --auto-add
```

**Example warning**:
```
⚠ New command: Demo (demo)
  Dependencies: subagent:coder-agent,subagent:missing-agent
    ⚠ Dependency not found in registry: subagent:missing-agent
```

#### 3. `validate-registry.sh` Script

**Purpose**: Comprehensive registry validation

**Checks**:
- ✅ All component paths exist
- ✅ All dependencies exist in registry
- ✅ No duplicate IDs
- ✅ Valid JSON structure
- ✅ Required fields present

**Usage**:
```bash
./scripts/registry/validate-registry.sh
```

**Example output**:
```
Validating registry.json...

✗ Dependency not found: opencoder → context:core/standards/code

Missing dependencies: 1
  - opencoder (agent) → context:core/standards/code

Fix: Add missing component to registry or remove from dependencies
```

---

## Quality Standards

### Well-Maintained Registry

A high-quality registry has:

✅ **Complete dependencies**: All component dependencies declared
✅ **Validated dependencies**: All dependencies exist in registry
✅ **No orphans**: All context files used by at least one component
✅ **Consistent format**: Dependencies use `type:id` format
✅ **Up-to-date**: Registry reflects current component state
✅ **No broken paths**: All component paths valid

### Dependency Declaration Standards

**DO**:
- ✅ Declare all subagents you delegate to
- ✅ Declare all context files you reference
- ✅ Declare all commands you invoke
- ✅ Use correct format: `type:id`
- ✅ Keep dependencies in frontmatter (not hardcoded in prompts)

**DON'T**:
- ❌ Reference context files without declaring dependency
- ❌ Use invalid dependency formats
- ❌ Declare dependencies you don't actually use
- ❌ Forget to update registry after adding dependencies

---

## Commit Guidelines

### When Adding/Modifying Components

**1. Add component with proper frontmatter** (example):
```
id: my-agent
name: My Agent
description: Does something useful
tags:
  - development
  - coding
dependencies:
  - subagent:coder-agent
  - context:core/standards/code
```

**2. Validate dependencies**:
```bash
/check-context-deps my-agent
```

**3. Update registry**:
```bash
./scripts/registry/auto-detect-components.sh --auto-add
```

**4. Validate registry**:
```bash
./scripts/registry/validate-registry.sh
```

**5. Commit with descriptive message**:
```bash
git add .opencode/agent/my-agent.md registry.json
git commit -m "Add my-agent with coder-agent and code standards dependencies"
```

### When Modifying Context Files

**1. Check which agents depend on it**:
```bash
jq '.components[] | .[] | select(.dependencies[]? | contains("context:core/standards/code")) | {id, name}' registry.json
```

**2. Update context file**:
```bash
# Make your changes
vim /Users/apple/.config/opencode/context/core/standards/code-quality.md
```

**3. Validate no broken references**:
```bash
/check-context-deps --verbose
```

**4. Update registry if needed**:
```bash
./scripts/registry/auto-detect-components.sh --auto-add
```

**5. Commit with impact note**:
```bash
git commit -m "Update code standards - affects opencoder, openagent, reviewer"
```

### When Deleting Components

**1. Check dependencies first**:
```bash
# Find what depends on this component
jq '.components[] | .[] | select(.dependencies[]? == "subagent:old-agent") | {id, name}' registry.json
```

**2. Remove from dependents**:
```bash
# Update agents that depend on it
# Remove the dependency from their frontmatter
```

**3. Delete component**:
```bash
rm .opencode/agent/subagents/old-agent.md
```

**4. Update registry**:
```bash
./scripts/registry/auto-detect-components.sh --auto-add
```

**5. Validate**:
```bash
./scripts/registry/validate-registry.sh
```

---

## Troubleshooting

### Missing Context Dependencies

**Symptom**:
```
/check-context-deps reports:
  opencoder: missing context:core/standards/code
```

**Fix**:
```bash
# Option 1: Auto-fix
/check-context-deps --fix

# Option 2: Manual fix
# Edit .opencode/agent/core/opencoder.md
# Add to frontmatter:
dependencies:
  - context:core/standards/code

# Then update registry
./scripts/registry/auto-detect-components.sh --auto-add
```

### Dependency Not Found in Registry

**Symptom**:
```
⚠ Dependency not found in registry: context:core/standards/code
```

**Causes**:
1. Context file doesn't exist
2. Context file exists but not in registry
3. Wrong dependency format

**Fix**:
```bash
# Check if file exists
ls -la /Users/apple/.config/opencode/context/core/standards/code-quality.md

# If exists, add to registry
./scripts/registry/auto-detect-components.sh --auto-add

# If doesn't exist, remove dependency or create file
```

### Unused Context Files

**Symptom**:
```
/check-context-deps reports:
  Unused: context:core/standards/analysis (0 references)
```

**Fix**:
```bash
# Option 1: Add to an agent that should use it
# Edit agent frontmatter to add dependency

# Option 2: Remove if truly unused
rm /Users/apple/.config/opencode/context/core/standards/code-analysis.md
./scripts/registry/auto-detect-components.sh --auto-add
```

### Circular Dependencies

**Symptom**:
```
Agent A depends on Agent B
Agent B depends on Agent A
```

**Fix**:
- Refactor to remove circular dependency
- Extract shared logic to a third component
- Use dependency injection instead

---

## CI/CD Integration

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Validating registry dependencies..."

# Check context dependencies
/check-context-deps || {
  echo "❌ Context dependency validation failed"
  echo "Run: /check-context-deps --fix"
  exit 1
}

# Validate registry
./scripts/registry/validate-registry.sh || {
  echo "❌ Registry validation failed"
  exit 1
}

echo "✅ Registry validation passed"
```

### GitHub Actions

```yaml
name: Validate Registry

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Validate registry
        run: ./scripts/registry/validate-registry.sh
      
      - name: Check context dependencies
        run: /check-context-deps
```

---

## Best Practices

### For Component Authors

1. **Always declare dependencies** in frontmatter
2. **Use `/check-context-deps`** before committing
3. **Update registry** after adding components
4. **Validate** before pushing
5. **Document** why dependencies are needed

### For Maintainers

1. **Review dependencies** in PRs
2. **Run validation** in CI/CD
3. **Keep context files** organized and documented
4. **Monitor unused** context files
5. **Refactor** when dependency graphs get complex

### For CI/CD

1. **Fail builds** on validation errors
2. **Report** missing dependencies
3. **Track** dependency changes over time
4. **Alert** on circular dependencies
5. **Enforce** dependency declaration standards

---

## Related Documentation

- **Registry Guide**: `/Users/apple/.config/opencode/context/openagents-repo/guides/updating-registry.md`
- **Registry Concepts**: `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/registry.md`
- **Adding Agents**: `/Users/apple/.config/opencode/context/openagents-repo/guides/adding-agent-basics.md`
- **Command Reference**: `/check-context-deps` command

---

## Summary

**Key Takeaways**:
1. Declare all dependencies in frontmatter (subagents, context files, etc.)
2. Use `/check-context-deps` to find missing context dependencies
3. Validate registry before commits
4. Keep registry in sync with component changes
5. Follow dependency format: `type:id`

**Quality Checklist**:
- [ ] All context files referenced have dependencies declared
- [ ] All dependencies exist in registry
- [ ] No unused context files (or documented why)
- [ ] Registry validates without errors
- [ ] Dependency format is consistent

**Remember**: Dependencies are documentation. They help users understand what components need and help the system validate integrity.
