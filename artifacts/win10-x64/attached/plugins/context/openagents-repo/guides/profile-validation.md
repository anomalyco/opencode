<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Profile Validation

**Purpose**: Ensure installation profiles include all appropriate components  
**Priority**: HIGH - Check this when adding new agents or updating registry

---

## What Are Profiles?

Profiles are pre-configured component bundles in `registry.json` that users install:
- **essential** - Minimal setup (openagent + core subagents)
- **developer** - Full dev environment (all dev agents + tools)
- **business** - Content/product focus (content agents + tools)
- **full** - Everything (all agents, subagents, tools)
- **advanced** - Full + meta-level (system-builder, repo-manager)

---

## The Problem

**Issue**: New agents added to `components.agents[]` but NOT added to profiles

**Result**: Users install a profile but don't get the new agents

**Example** (v0.5.0 bug):
```json
// ✅ Agent exists in components
{
  "id": "devops-specialist",
  "path": ".opencode/agent/subagents/development/devops-specialist.md"
}

// ❌ But NOT in developer profile
"developer": {
  "components": [
    "agent:openagent",
    "agent:opencoder"
    // Missing: "agent:devops-specialist"
  ]
}
```

---

## Validation Checklist

When adding a new agent, **ALWAYS** check:

### 1. Agent Added to Components
```bash
# Check agent exists in registry
cat registry.json | jq '.components.agents[] | select(.id == "your-agent")'
```

### 2. Agent Added to Appropriate Profiles

**Development agents** → Add to:
- ✅ `developer` profile
- ✅ `full` profile
- ✅ `advanced` profile

**Content agents** → Add to:
- ✅ `business` profile
- ✅ `full` profile
- ✅ `advanced` profile

**Data agents** → Add to:
- ✅ `business` profile (if business-focused)
- ✅ `full` profile
- ✅ `advanced` profile

**Meta agents** → Add to:
- ✅ `advanced` profile only

**Core agents** → Add to:
- ✅ `essential` profile
- ✅ All other profiles

### 3. Verify Profile Includes Agent

```bash
# Check if agent is in developer profile
cat registry.json | jq '.profiles.developer.components[] | select(. == "agent:your-agent")'

# Check if agent is in business profile
cat registry.json | jq '.profiles.business.components[] | select(. == "agent:your-agent")'

# Check if agent is in full profile
cat registry.json | jq '.profiles.full.components[] | select(. == "agent:your-agent")'
```

---

## Profile Assignment Rules

### Developer Profile
**Include**:
- Core agents (openagent, opencoder)
- Development specialist subagents (frontend, devops)
- All code subagents (tester, reviewer, coder-agent, build-agent)
- Dev commands (commit, test, validate-repo, analyze-patterns)
- Dev context (standards/code, standards/tests, workflows/*)
- Utility subagents (image-specialist for website images)
- Tools (env, gemini for image generation)

**Exclude**:
- Content agents (copywriter, technical-writer)
- Data agents (data-analyst)
- Meta agents (system-builder, repo-manager)

### Business Profile
**Include**:
- Core agent (openagent)
- Content specialists (copywriter, technical-writer)
- Data specialists (data-analyst)
- Image tools (gemini, image-specialist)
- Notification tools (notify)

**Exclude**:
- Development specialists
- Code subagents
- Meta agents

### Full Profile
**Include**:
- Everything from developer profile
- Everything from business profile
- All agents except meta agents

**Exclude**:
- Meta agents (system-builder, repo-manager)

### Advanced Profile
**Include**:
- Everything from full profile
- Meta agents (system-builder, repo-manager)
- Meta subagents (domain-analyzer, agent-generator, etc.)
- Meta commands (build-context-system)

---

## Automated Validation

### Script to Check Profile Coverage

```bash
#!/bin/bash
# Check if all agents are in appropriate profiles

echo "Checking profile coverage..."

# Get all agent IDs
agents=$(cat registry.json | jq -r '.components.agents[].id')

for agent in $agents; do
  # Get agent category
  category=$(cat registry.json | jq -r ".components.agents[] | select(.id == \"$agent\") | .category")
  
  # Check which profiles include this agent
  in_developer=$(cat registry.json | jq ".profiles.developer.components[] | select(. == \"agent:$agent\")" 2>/dev/null)
  in_business=$(cat registry.json | jq ".profiles.business.components[] | select(. == \"agent:$agent\")" 2>/dev/null)
  in_full=$(cat registry.json | jq ".profiles.full.components[] | select(. == \"agent:$agent\")" 2>/dev/null)
  in_advanced=$(cat registry.json | jq ".profiles.advanced.components[] | select(. == \"agent:$agent\")" 2>/dev/null)
  
  # Validate based on category
  case $category in
    "development")
      if [[ -z "$in_developer" ]]; then
        echo "❌ $agent (development) missing from developer profile"
      fi
      if [[ -z "$in_full" ]]; then
        echo "❌ $agent (development) missing from full profile"
      fi
      if [[ -z "$in_advanced" ]]; then
        echo "❌ $agent (development) missing from advanced profile"
      fi
      ;;
    "content"|"data")
      if [[ -z "$in_business" ]]; then
        echo "❌ $agent ($category) missing from business profile"
      fi
      if [[ -z "$in_full" ]]; then
        echo "❌ $agent ($category) missing from full profile"
      fi
      if [[ -z "$in_advanced" ]]; then
        echo "❌ $agent ($category) missing from advanced profile"
      fi
      ;;
    "meta")
      if [[ -z "$in_advanced" ]]; then
        echo "❌ $agent (meta) missing from advanced profile"
      fi
      ;;
    "essential"|"standard")
      if [[ -z "$in_full" ]]; then
        echo "❌ $agent ($category) missing from full profile"
      fi
      if [[ -z "$in_advanced" ]]; then
        echo "❌ $agent ($category) missing from advanced profile"
      fi
      ;;
  esac
done

echo "✅ Profile coverage check complete"
```

Save this as: `scripts/registry/validate-profile-coverage.sh`

---

## Manual Validation Steps

### After Adding a New Agent

1. **Add agent to components**:
   ```bash
   ./scripts/registry/auto-detect-components.sh --auto-add
   ```

2. **Manually add to profiles**:
   Edit `registry.json` and add `"agent:your-agent"` to appropriate profiles

3. **Validate registry**:
   ```bash
   ./scripts/registry/validate-registry.sh
   ```

4. **Test local install**:
   ```bash
   # Test developer profile
   REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list
   
   # Verify agent appears in profile
   REGISTRY_URL="file://$(pwd)/registry.json" ./install.sh --list | grep "your-agent"
   ```

5. **Test actual install**:
   ```bash
   # Install to temp directory
   mkdir -p /tmp/test-install
   cd /tmp/test-install
   REGISTRY_URL="file://$(pwd)/registry.json" bash <(curl -s https://raw.githubusercontent.com/darrenhinde/OpenAgentsControl/main/install.sh) developer
   
   # Check if agent was installed
   ls .opencode/agent/category/your-agent.md
   ```

---

## Common Mistakes

### ❌ Mistake 1: Only Adding to Components
```json
// Added to components
"components": {
  "agents": [
    {"id": "new-agent", ...}
  ]
}

// But forgot to add to profiles
"profiles": {
  "developer": {
    "components": [
      // Missing: "agent:new-agent"
    ]
  }
}
```

### ❌ Mistake 2: Wrong Profile Assignment
```json
// Development agent added to business profile
"business": {
  "components": [
    "agent:devops-specialist"  // ❌ Should be in developer
  ]
}
```

### ❌ Mistake 3: Inconsistent Profile Coverage
```json
// Added to full but not advanced
"full": {
  "components": ["agent:new-agent"]
},
"advanced": {
  "components": [
    // ❌ Missing: "agent:new-agent"
  ]
}
```

---

## Best Practices

✅ **Use auto-detect** - Adds to components automatically  
✅ **Check all profiles** - Verify agent in correct profiles  
✅ **Test locally** - Install and verify before pushing  
✅ **Validate** - Run validation script after changes  
✅ **Document** - Update CHANGELOG with profile changes  

---

## CI/CD Integration

Add profile validation to CI:

```yaml
# .github/workflows/validate-registry.yml
- name: Validate Registry
  run: ./scripts/registry/validate-registry.sh

- name: Validate Profile Coverage
  run: ./scripts/registry/validate-profile-coverage.sh
```

---

## Quick Reference

| Agent Category | Essential | Developer | Business | Full | Advanced |
|---------------|-----------|-----------|----------|------|----------|
| core          | ✅        | ✅        | ✅       | ✅   | ✅       |
| development*  | ❌        | ✅        | ❌       | ✅   | ✅       |
| content       | ❌        | ❌        | ✅       | ✅   | ✅       |
| data          | ❌        | ❌        | ✅       | ✅   | ✅       |
| meta          | ❌        | ❌        | ❌       | ❌   | ✅       |

*Note: Development category includes agents (opencoder) and specialist subagents (frontend, devops)

---

## Development Profile Changes (v2.0.0)

**What Changed**:
- frontend-specialist: Agent → Subagent (specialized executor)
- devops-specialist: Agent → Subagent (specialized executor)
- backend-specialist: Removed (functionality covered by opencoder)
- codebase-pattern-analyst: Removed (replaced by analyze-patterns command)
- analyze-patterns: New command for pattern analysis

**Why**:
- Streamlined main agents to 2 (openagent, opencoder)
- Specialist subagents provide focused expertise when needed
- Reduced cognitive load for new users
- Clearer separation between main agents and specialized tools

**Impact**:
- Developer profile now has 2 main agents + 8 subagents
- Smaller, more focused profile
- Same capabilities, better organization
- No breaking changes for existing workflows

---

## Related Files

- **Registry concepts**: `core-concepts/registry.md`
- **Updating registry**: `guides/updating-registry.md`
- **Adding agents**: `guides/adding-agent.md`

---

**Last Updated**: 2025-01-28  
**Version**: 0.5.2
