<!-- Context: openagents-repo/lookup | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Lookup: Command Reference

**Purpose**: Quick reference for common commands

---

## Registry Commands

### Validate Registry

```bash
# Basic validation
./scripts/registry/validate-registry.sh

# Verbose output
./scripts/registry/validate-registry.sh -v
```

### Auto-Detect Components

```bash
# Dry run (see what would change)
./scripts/registry/auto-detect-components.sh --dry-run

# Add new components
./scripts/registry/auto-detect-components.sh --auto-add

# Force update existing
./scripts/registry/auto-detect-components.sh --auto-add --force
```

### Validate Component Structure

```bash
./scripts/registry/validate-component.sh
```

---

## Testing Commands

### Run Tests

```bash
# Single test
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --pattern="{test}.yaml"

# All tests for agent
npm run eval:sdk -- --agent={category}/{agent}

# All tests (all agents)
npm run eval:sdk

# With debug
npm run eval:sdk -- --agent={agent} --debug
```

### Validate Test Suites

```bash
./scripts/validation/validate-test-suites.sh
```

---

## Installation Commands

### Install Components

```bash
# List available components
./install.sh --list

# Install profile
./install.sh {profile}
# Profiles: essential, developer, business

# Install specific component
./install.sh --component agent:{agent-name}

# Test with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

### Collision Handling

```bash
# Skip existing files
./install.sh developer --skip-existing

# Overwrite all
./install.sh developer --force

# Backup existing
./install.sh developer --backup
```

---

## Version Commands

### Check Version

```bash
# Check all version files
cat VERSION
cat package.json | jq '.version'
cat registry.json | jq '.version'
```

### Update Version

```bash
# Update VERSION
echo "0.X.Y" > VERSION

# Update package.json
jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json

# Update registry.json
jq '.version = "0.X.Y"' registry.json > tmp && mv tmp registry.json
```

### Bump Version Script

```bash
./scripts/versioning/bump-version.sh 0.X.Y
```

---

## Git Commands

### Create Release

```bash
# Commit version changes
git add VERSION package.json CHANGELOG.md
git commit -m "chore: bump version to 0.X.Y"

# Create tag
git tag -a v0.X.Y -m "Release v0.X.Y"

# Push
git push origin main
git push origin v0.X.Y
```

### Create GitHub Release

```bash
# Via GitHub CLI
gh release create v0.X.Y \
  --title "v0.X.Y" \
  --notes "See CHANGELOG.md for details"
```

---

## Validation Commands

### Full Validation

```bash
# Validate everything
./scripts/registry/validate-registry.sh && \
./scripts/validation/validate-test-suites.sh && \
cd evals/framework && npm run eval:sdk
```

### Check Context Dependencies

```bash
# Analyze all agents
/check-context-deps

# Analyze specific agent
/check-context-deps contextscout

# Auto-fix missing dependencies
/check-context-deps --fix
```

### Validate Context References

```bash
./scripts/validation/validate-context-refs.sh
```

### Setup Pre-Commit Hook

```bash
./scripts/validation/setup-pre-commit-hook.sh
```

---

## Development Commands

### Run Demo

```bash
./scripts/development/demo.sh
```

### Run Dashboard

```bash
./scripts/development/dashboard.sh
```

---

## Maintenance Commands

### Cleanup Stale Sessions

```bash
./scripts/maintenance/cleanup-stale-sessions.sh
```

### Uninstall

```bash
./scripts/maintenance/uninstall.sh
```

---

## Debugging Commands

### Check Sessions

```bash
# List recent sessions
ls -lt .tmp/sessions/ | head -5

# View session
cat .tmp/sessions/{session-id}/session.json | jq

# View events
cat .tmp/sessions/{session-id}/events.json | jq
```

### Check Context Logs

```bash
# Check session cache
./scripts/check-context-logs/check-session-cache.sh

# Count agent tokens
./scripts/check-context-logs/count-agent-tokens.sh

# Show API payload
./scripts/check-context-logs/show-api-payload.sh

# Show cached data
./scripts/check-context-logs/show-cached-data.sh
```

---

## Quick Workflows

### Adding a New Agent

```bash
# 1. Create agent file
touch .opencode/agent/{category}/{agent-name}.md
# (Add frontmatter and content)

# 2. Create test structure
mkdir -p evals/agents/{category}/{agent-name}/{config,tests}
# (Create config.yaml and smoke-test.yaml)

# 3. Update registry
./scripts/registry/auto-detect-components.sh --auto-add

# 4. Validate
./scripts/registry/validate-registry.sh
cd evals/framework && npm run eval:sdk -- --agent={category}/{agent-name}
```

### Testing an Agent

```bash
# 1. Run smoke test
cd evals/framework
npm run eval:sdk -- --agent={category}/{agent} --pattern="smoke-test.yaml"

# 2. If fails, debug
npm run eval:sdk -- --agent={category}/{agent} --debug

# 3. Check session
ls -lt .tmp/sessions/ | head -1
cat .tmp/sessions/{session-id}/session.json | jq
```

### Creating a Release

```bash
# 1. Update version
echo "0.X.Y" > VERSION
jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json

# 2. Update CHANGELOG
# (Edit CHANGELOG.md)

# 3. Commit and tag
git add VERSION package.json CHANGELOG.md
git commit -m "chore: bump version to 0.X.Y"
git tag -a v0.X.Y -m "Release v0.X.Y"

# 4. Push
git push origin main
git push origin v0.X.Y

# 5. Create GitHub release
gh release create v0.X.Y --title "v0.X.Y" --notes "See CHANGELOG.md"
```

---

## Common Patterns

### Find Files

```bash
# Find agent
find .opencode/agent -name "{agent-name}.md"

# Find tests
find evals/agents -name "*.yaml"

# Find context
find /Users/apple/.config/opencode/context -name "*.md"

# Find scripts
find scripts -name "*.sh"
```

### Check Registry

```bash
# List all agents
cat registry.json | jq '.components.agents[].id'

# Check specific component
cat registry.json | jq '.components.agents[] | select(.id == "{agent-name}")'

# Count components
cat registry.json | jq '.components.agents | length'
```

### Test Locally

```bash
# Test with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list

# Install locally
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh developer
```

---

## NPM Commands (Eval Framework)

```bash
cd evals/framework

# Install dependencies
npm install

# Run tests
npm test

# Run eval SDK
npm run eval:sdk

# Build
npm run build

# Lint
npm run lint
```

---

## Related Files

- **Quick start**: `quick-start.md`
- **File locations**: `lookup/file-locations.md`
- **Guides**: `guides/`

---

**Last Updated**: 2025-12-10  
**Version**: 0.5.0
