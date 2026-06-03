<!-- Context: openagents-repo/quick-start | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# OpenAgents Control Repository - Quick Start

**Purpose**: Get oriented in this repo in 2 minutes

---

## What Is This Repo?

OpenAgents Control is an AI agent framework with:
- **Category-based agents** (core, development, content, data, product, learning)
- **Eval framework** for testing agent behavior
- **Registry system** for component distribution
- **Install system** for easy setup

---

## Core Concepts (Load These First)

Before working on this repo, understand these 4 systems:

1. **Agents** → Load: `core-concepts/agents.md`
   - How agents are structured
   - Category system
   - Prompt variants
   - Subagents vs category agents

2. **Evals** → Load: `core-concepts/evals.md`
   - How testing works
   - Running tests
   - Evaluators
   - Session collection

3. **Registry** → Load: `core-concepts/registry.md`
   - How components are tracked
   - Auto-detect system
   - Validation
   - Install system

4. **Categories** → Load: `core-concepts/categories.md`
   - How organization works
   - Naming conventions
   - Path patterns

---

## I Need To...

| Task | Load These Files |
|------|------------------|
| Add a new agent | `core-concepts/agents.md` + `guides/adding-agent.md` |
| Test an agent | `core-concepts/evals.md` + `guides/testing-agent.md` |
| Fix registry | `core-concepts/registry.md` + `guides/updating-registry.md` |
| Debug issue | `guides/debugging.md` |
| Find files | `lookup/file-locations.md` |
| Create release | `guides/creating-release.md` |
| Write content or copy | `core-concepts/categories.md` + `../content-creation/principles/navigation.md` |
| Use Claude Code helpers | `core-concepts/agents.md` + `guides/adding-agent.md` + `../to-be-consumed/claude-code-docs/create-subagents.md` |

---

## Essential Paths (Top 15)

```
.opencode/agent/core/                    # Core agents (openagent, opencoder)
.opencode/agent/{category}/              # Category agents
.opencode/agent/subagents/               # Subagents
evals/agents/{category}/{agent}/         # Agent tests
evals/framework/src/                     # Eval framework code
registry.json                            # Component catalog
install.sh                               # Installer
scripts/registry/validate-registry.sh    # Validate registry
scripts/registry/auto-detect-components.sh # Auto-detect components
scripts/validation/validate-test-suites.sh # Validate tests
/Users/apple/.config/opencode/context/                       # Context files
.opencode/command/                       # Slash commands
docs/                                    # Documentation
VERSION                                  # Current version
package.json                             # Node dependencies
```

---

## Common Commands (Top 10)

```bash
# Add new agent (auto-detect)
./scripts/registry/auto-detect-components.sh --auto-add

# Validate registry
./scripts/registry/validate-registry.sh

# Test agent
cd evals/framework && npm run eval:sdk -- --agent={category}/{agent}

# Run smoke test
cd evals/framework && npm run eval:sdk -- --agent={agent} --pattern="smoke-test.yaml"

# Test with debug
cd evals/framework && npm run eval:sdk -- --agent={agent} --debug

# Validate test suites
./scripts/validation/validate-test-suites.sh

# Install locally (test)
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list

# Bump version
echo "0.X.Y" > VERSION && jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json

# Check version consistency
cat VERSION && cat package.json | jq '.version'

# Run full validation
./scripts/registry/validate-registry.sh && ./scripts/validation/validate-test-suites.sh
```

---

## Repository Structure (Quick View)

```
opencode-agents/
├── .opencode/
│   ├── agent/{category}/        # Agents by domain
│   │   ├── core/                # Core system agents
│   │   ├── development/         # Dev specialists
│   │   ├── content/             # Content creators
│   │   ├── data/                # Data analysts
│   │   ├── product/             # Product managers
│   │   ├── learning/            # Educators
│   │   └── subagents/           # Delegated specialists
│   ├── command/                 # Slash commands
│   └── context/                 # Shared knowledge
├── evals/
│   ├── agents/{category}/       # Test suites
│   └── framework/               # Eval framework
├── scripts/
│   ├── registry/                # Registry tools
│   └── validation/              # Validation tools
├── docs/                        # Documentation
├── registry.json                # Component catalog
└── install.sh                   # Installer
```

---

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Registry validation fails | `./scripts/registry/auto-detect-components.sh --auto-add` |
| Test fails | Load `guides/debugging.md` |
| Can't find file | Load `lookup/file-locations.md` |
| Install fails | Check: `which curl jq` |
| Path resolution issues | Check `core-concepts/categories.md` |

---

## Next Steps

1. **First time?** → Read `core-concepts/agents.md`, `evals.md`, `registry.md`
2. **Adding agent?** → Load `guides/adding-agent.md`
3. **Testing?** → Load `guides/testing-agent.md`
4. **Need details?** → Load specific files from `core-concepts/` or `guides/`

---

**Last Updated**: 2026-01-13  
**Version**: 0.5.1
