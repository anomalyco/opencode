<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Adding a New Agent (Basics)

**Prerequisites**: Load `core-concepts/agents.md` first  
**Purpose**: Create and register a new agent in 4 steps

---

## Overview

Adding a new agent involves:
1. Creating the agent file
2. Creating test structure
3. Updating the registry
4. Validating everything works

**Time**: ~15-20 minutes

---

## Step 1: Create Agent File

### Choose Category

```bash
# Available categories:
# - core/          (system agents)
# - development/   (dev specialists)
# - content/       (content creators)
# - data/          (data analysts)
# - product/       (product managers)
# - learning/      (educators)
```

### Create File with Frontmatter

```bash
touch .opencode/agent/{category}/{agent-name}.md
```

```markdown
---
description: "Brief description of what this agent does"
category: "{category}"
type: "agent"
tags: ["tag1", "tag2"]
dependencies: []
---

# Agent Name

**Purpose**: What this agent does

## Focus
- Key responsibility 1
- Key responsibility 2

## Workflow
1. Step 1
2. Step 2

## Constraints
- Constraint 1
- Constraint 2
```

---

## Step 2: Create Test Structure

```bash
# Create directories
mkdir -p evals/agents/{category}/{agent-name}/{config,tests}

# Create config
cat > evals/agents/{category}/{agent-name}/config/config.yaml << 'EOF'
agent: {category}/{agent-name}
model: anthropic/claude-sonnet-4-5
timeout: 60000
suites:
  - smoke
EOF

# Create smoke test
cat > evals/agents/{category}/{agent-name}/tests/smoke-test.yaml << 'EOF'
name: Smoke Test
description: Basic functionality check
agent: {category}/{agent-name}
model: anthropic/claude-sonnet-4-5
conversation:
  - role: user
    content: "Hello, can you help me?"
expectations:
  - type: no_violations
EOF
```

---

## Step 3: Update Registry

```bash
# Dry run first
./scripts/registry/auto-detect-components.sh --dry-run

# Add to registry
./scripts/registry/auto-detect-components.sh --auto-add

# Verify
cat registry.json | jq '.components.agents[] | select(.id == "{agent-name}")'
```

---

## Step 4: Validate

```bash
# Validate registry
./scripts/registry/validate-registry.sh

# Run smoke test
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent-name} --pattern="smoke-test.yaml"

# Test installation
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

---

## Checklist

- [ ] Agent file created with proper frontmatter
- [ ] Test structure created (config + smoke test)
- [ ] Registry updated via auto-detect
- [ ] Registry validation passes
- [ ] Smoke test passes
- [ ] Agent appears in `./install.sh --list`

---

## Next Steps

- **Add more tests** → `adding-agent-testing.md`
- **Test thoroughly** → `testing-agent.md`
- **Debug issues** → `debugging.md`

---

## Related

- `core-concepts/agents.md` - Agent concepts
- `adding-agent-testing.md` - Additional test patterns
- `testing-agent.md` - Testing guide
- `creating-subagents.md` - Claude Code subagents (different system)
