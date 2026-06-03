<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Debugging Common Issues

**Purpose**: Troubleshooting guide for common problems

---

## Quick Diagnostics

```bash
# Check system health
./scripts/registry/validate-registry.sh
./scripts/validation/validate-test-suites.sh

# Check version consistency
cat VERSION && cat package.json | jq '.version'

# Test core agents
cd evals/framework && npm run eval:sdk -- --agent=core/openagent --pattern="smoke-test.yaml"
```

---

## Registry Issues

### Registry Validation Fails

**Symptoms**:
```
ERROR: Path does not exist: (example: .opencode/agent/core/missing.md)
```

**Diagnosis**:
```bash
./scripts/registry/validate-registry.sh -v
```

**Solutions**:
1. **Path doesn't exist**: Remove entry or create file
2. **Duplicate ID**: Rename one component
3. **Invalid category**: Use valid category

**Fix**:
```bash
# Re-run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add

# Validate
./scripts/registry/validate-registry.sh
```

---

### Component Not in Registry

**Symptoms**:
- Component doesn't appear in `./install.sh --list`
- Auto-detect doesn't find component

**Diagnosis**:
```bash
# Check frontmatter
head -10 .opencode/agent/{category}/{agent}.md

# Dry run auto-detect
./scripts/registry/auto-detect-components.sh --dry-run
```

**Solutions**:
1. **Missing frontmatter**: Add frontmatter
2. **Invalid YAML**: Fix YAML syntax
3. **Wrong location**: Move to correct directory

**Fix**:
```bash
# Add frontmatter
cat > .opencode/agent/{category}/{agent}.md << 'EOF'
---
description: "Brief description"
category: "category"
type: "agent"
---

# Agent Content
EOF

# Re-run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add
```

---

## Test Failures

### Approval Gate Violation

**Symptoms**:
```
✗ Approval Gate: FAIL
  Violation: Agent executed write tool without requesting approval
```

**Diagnosis**:
```bash
# Run with debug
cd evals/framework
npm run eval:sdk -- --agent={agent} --pattern="{test}" --debug

# Check session
ls -lt .tmp/sessions/ | head -5
cat .tmp/sessions/{session-id}/session.json | jq
```

**Solution**:
Add approval request in agent prompt:
```markdown
Before executing:
1. Present plan to user
2. Request approval
3. Execute after approval
```

---

### Context Loading Violation

**Symptoms**:
```
✗ Context Loading: FAIL
  Violation: Agent executed write tool without loading required context
```

**Diagnosis**:
```bash
# Check what context was loaded
cat .tmp/sessions/{session-id}/events.json | jq '.[] | select(.type == "context_load")'
```

**Solution**:
Add context loading in agent prompt:
```markdown
Before implementing:
1. Load core/standards/code-quality.md
2. Apply standards to implementation
```

---

### Tool Usage Violation

**Symptoms**:
```
✗ Tool Usage: FAIL
  Violation: Agent used bash tool for reading file instead of read tool
```

**Diagnosis**:
```bash
# Check tool usage
cat .tmp/sessions/{session-id}/events.json | jq '.[] | select(.type == "tool_call")'
```

**Solution**:
Update agent to use correct tools:
- Use `read` instead of `bash cat`
- Use `list` instead of `bash ls`
- Use `grep` instead of `bash grep`

---

## Install Issues

### Install Script Fails

**Symptoms**:
```
ERROR: Failed to fetch registry
ERROR: Component not found
```

**Diagnosis**:
```bash
# Check dependencies
which curl jq

# Test with local registry
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

**Solutions**:
1. **Missing dependencies**: Install curl and jq
2. **Registry not found**: Check registry.json exists
3. **Component not found**: Verify component in registry

**Fix**:
```bash
# Install dependencies (macOS)
brew install curl jq

# Install dependencies (Linux)
sudo apt-get install curl jq

# Test locally
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

---

### Collision Handling

**Symptoms**:
```
File exists: .opencode/agent/core/openagent.md
```

**Solutions**:
1. **Skip**: Keep existing file
2. **Overwrite**: Replace with new file
3. **Backup**: Backup existing, install new

**Fix**:
```bash
# Skip all collisions
./install.sh developer --skip-existing

# Overwrite all collisions
./install.sh developer --force

# Backup all collisions
./install.sh developer --backup
```

---

## Path Resolution Issues

### Agent Not Found

**Symptoms**:
```
ERROR: Agent not found: development/frontend-specialist
```

**Diagnosis**:
```bash
# Check file exists
ls -la .opencode/agent/subagents/development/frontend-specialist.md

# Check registry
cat registry.json | jq '.components.agents[] | select(.id == "frontend-specialist")'
```

**Solutions**:
1. **File doesn't exist**: Create file
2. **Wrong path**: Fix path in registry
3. **Not in registry**: Run auto-detect

**Fix**:
```bash
# Re-run auto-detect
./scripts/registry/auto-detect-components.sh --auto-add

# Validate
./scripts/registry/validate-registry.sh
```

---

## Version Issues

### Version Mismatch

**Symptoms**:
```
VERSION: 0.5.0
package.json: 0.4.0
registry.json: 0.5.0
```

**Diagnosis**:
```bash
cat VERSION
cat package.json | jq '.version'
cat registry.json | jq '.version'
```

**Solution**:
Update all to same version:
```bash
echo "0.5.0" > VERSION
jq '.version = "0.5.0"' package.json > tmp && mv tmp package.json
jq '.version = "0.5.0"' registry.json > tmp && mv tmp registry.json
```

---

## CI/CD Issues

### Workflow Fails

**Symptoms**:
- Registry validation fails in CI
- Tests fail in CI but pass locally

**Diagnosis**:
```bash
# Run same commands as CI
./scripts/registry/validate-registry.sh
./scripts/validation/validate-test-suites.sh
cd evals/framework && npm run eval:sdk
```

**Solutions**:
1. **Registry invalid**: Fix registry
2. **Tests fail**: Fix tests
3. **Dependencies missing**: Update CI config

---

## Performance Issues

### Tests Timeout

**Symptoms**:
```
ERROR: Test timeout after 60000ms
```

**Solution**:
Increase timeout in config.yaml:
```yaml
timeout: 120000  # 2 minutes
```

---

### Slow Auto-Detect

**Symptoms**:
Auto-detect takes too long

**Solution**:
Limit scope:
```bash
# Only scan specific directory
./scripts/registry/auto-detect-components.sh --path .opencode/agent/development/
```

---

## Getting Help

### Check Logs

```bash
# Session logs
ls -lt .tmp/sessions/ | head -5
cat .tmp/sessions/{session-id}/session.json | jq

# Event timeline
cat .tmp/sessions/{session-id}/events.json | jq
```

### Run Diagnostics

```bash
# Full system check
./scripts/registry/validate-registry.sh -v
./scripts/validation/validate-test-suites.sh
cd evals/framework && npm run eval:sdk -- --agent=core/openagent
```

### Common Commands

```bash
# Validate everything
./scripts/registry/validate-registry.sh && \
./scripts/validation/validate-test-suites.sh && \
cd evals/framework && npm run eval:sdk

# Reset and rebuild
./scripts/registry/auto-detect-components.sh --auto-add --force
./scripts/registry/validate-registry.sh

# Test installation
REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
```

---

## Related Files

- **Testing guide**: `guides/testing-agent.md`
- **Registry guide**: `guides/updating-registry.md`
- **Eval concepts**: `core-concepts/evals.md`

---

**Last Updated**: 2025-12-10  
**Version**: 0.5.0
