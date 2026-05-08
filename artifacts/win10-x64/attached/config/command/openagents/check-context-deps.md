---
description: Validate context file dependencies across agents and registry
tags:
  - registry
  - validation
  - context
  - dependencies
  - openagents
dependencies:
  - command:analyze-patterns
---

# Check Context Dependencies

**Purpose**: Ensure agents properly declare their context file dependencies in frontmatter and registry.

**Arguments**: `$ARGUMENTS`

---

## What It Does

Validates consistency between:
1. **Actual usage** - Context files referenced in agent prompts
2. **Declared dependencies** - Dependencies in agent frontmatter
3. **Registry entries** - Dependencies in registry.json

**Identifies**:
- ✅ Missing dependency declarations (agents use context but don't declare it)
- ✅ Unused context files (exist but no agent references them)
- ✅ Broken references (referenced but don't exist)
- ✅ Format inconsistencies (wrong dependency format)

---

## Usage

```bash
# Analyze all agents
/check-context-deps

# Analyze specific agent
/check-context-deps contextscout

# Auto-fix missing dependencies
/check-context-deps --fix

# Verbose output (show all reference locations)
/check-context-deps --verbose

# Combine flags
/check-context-deps contextscout --verbose
```

---

## Workflow

<workflow id="analyze_context_dependencies">
  <stage id="1" name="ScanAgents" required="true">
    Scan agent files for context references:
    
    **Search patterns**:
    - `/Users/apple/.config/opencode/context/` (direct path references)
    - `@/Users/apple/.config/opencode/context/` (@ symbol references)
    - `context:` (dependency declarations in frontmatter)
    
    **Locations**:
    - `.opencode/agent/**/*.md` (all agents and subagents)
    - `.opencode/command/**/*.md` (commands that use context)
    
    **Extract**:
    - Agent/command ID
    - Context file path
    - Line number
    - Reference type (path, @-reference, dependency)
  </stage>
  
  <stage id="2" name="CheckRegistry" required="true">
    For each agent found, check registry.json:
    
    ```bash
    jq '.components.agents[] | select(.id == "AGENT_ID") | .dependencies' registry.json
    jq '.components.subagents[] | select(.id == "AGENT_ID") | .dependencies' registry.json
    ```
    
    **Verify**:
    - Does the agent have a dependencies array?
    - Are context file references declared as `context:core/standards/code`?
    - Are the dependency formats correct (`context:path/to/file`)?
  </stage>
  
  <stage id="3" name="ValidateContextFiles" required="true">
    For each context file referenced:
    
    **Check existence**:
    ```bash
    test -f /Users/apple/.config/opencode/context/core/standards/code-quality.md
    ```
    
    **Check registry**:
    ```bash
    jq '.components.contexts[] | select(.id == "core/standards/code")' registry.json
    ```
    
    **Identify issues**:
    - Context file referenced but doesn't exist
    - Context file exists but not in registry
    - Context file in registry but never used
  </stage>
  
  <stage id="4" name="Report" required="true">
    Generate comprehensive report:
    
    ```markdown
    # Context Dependency Analysis Report
    
    ## Summary
    - Agents scanned: 25
    - Context files referenced: 12
    - Missing dependencies: 8
    - Unused context files: 2
    - Missing context files: 0
    
    ## Missing Dependencies (agents using context but not declaring)
    
    ### opencoder
    **Uses but not declared**:
    - context:core/standards/code (referenced 3 times)
      - Line 64: "Code tasks → /Users/apple/.config/opencode/context/core/standards/code-quality.md (MANDATORY)"
      - Line 170: "Read /Users/apple/.config/opencode/context/core/standards/code-quality.md NOW"
      - Line 229: "NEVER execute write/edit without loading required context first"
    
    **Current dependencies**: subagent:task-manager, subagent:coder-agent
    **Recommended fix**: Add to frontmatter:
    ```yaml
    dependencies:
      - subagent:task-manager
      - subagent:coder-agent
      - context:core/standards/code  # ADD THIS
    ```
    
    ### openagent
    **Uses but not declared**:
    - context:core/standards/code (referenced 5 times)
    - context:core/standards/docs (referenced 3 times)
    - context:core/standards/tests (referenced 3 times)
    - context:core/workflows/review (referenced 2 times)
    - context:core/workflows/delegation (referenced 4 times)
    
    **Recommended fix**: Add to frontmatter:
    ```yaml
    dependencies:
      - subagent:task-manager
      - subagent:documentation
      - context:core/standards/code
      - context:core/standards/docs
      - context:core/standards/tests
      - context:core/workflows/review
      - context:core/workflows/delegation
    ```
    
    ## Unused Context Files (exist but no agent references them)
    
    - context:core/standards/analysis (0 references)
    - context:core/workflows/sessions (0 references)
    
    **Recommendation**: Consider removing or documenting intended use
    
    ## Missing Context Files (referenced but don't exist)
    
    None found ✅
    
    ## Context File Usage Map
    
    | Context File | Used By | Reference Count |
    |--------------|---------|-----------------|
    | core/standards/code | opencoder, openagent, frontend-specialist, reviewer | 15 |
    | core/standards/docs | openagent, documentation, technical-writer | 8 |
    | core/standards/tests | openagent, tester | 6 |
    | core/workflows/delegation | openagent, task-manager | 5 |
    | core/workflows/review | openagent, reviewer | 4 |
    
    ---
    
    ## Next Steps
    
    1. Review missing dependencies above
    2. Run `/check-context-deps --fix` to auto-update frontmatter
    3. Run `./scripts/registry/auto-detect-components.sh` to update registry
    4. Verify with `./scripts/registry/validate-registry.sh`
    ```
  </stage>
  
  <stage id="5" name="Fix" when="--fix flag provided">
    For each agent with missing context dependencies:
    
    1. Read the agent file
    2. Parse frontmatter YAML
    3. Add missing context dependencies to dependencies array
    4. Preserve existing dependencies
    5. Write updated file
    6. Report what was changed
    
    **Example**:
    ```diff
    ---
    id: opencoder
    dependencies:
      - subagent:task-manager
      - subagent:coder-agent
    + - context:core/standards/code
    ---
    ```
    
    **Safety**:
    - Only add dependencies that are actually referenced in the file
    - Don't remove existing dependencies
    - Preserve frontmatter formatting
    - Show diff before applying (if interactive)
  </stage>
</workflow>

---

## Implementation Details

### Search Patterns

**Find direct path references**:
```bash
grep -rn "\/Users/apple/.config/opencode/context/" .opencode/agent/ .opencode/command/
```

**Find @ references**:
```bash
grep -rn "@\/Users/apple/.config/opencode/context/" .opencode/agent/ .opencode/command/
```

**Find dependency declarations**:
```bash
grep -rn "^\s*-\s*context:" .opencode/agent/ .opencode/command/
```

### Path Normalization

**Convert to dependency format**:
- `/Users/apple/.config/opencode/context/core/standards/code-quality.md` → `context:core/standards/code`
- `@/Users/apple/.config/opencode/context/openagents-repo/quick-start.md` → `context:openagents-repo/quick-start`
- `context/core/standards/code` → `context:core/standards/code`

**Rules**:
1. Strip `.opencode/` prefix
2. Strip `.md` extension
3. Add `context:` prefix for dependencies

### Registry Lookup

**Check if context file is in registry**:
```bash
jq '.components.contexts[] | select(.id == "core/standards/code")' registry.json
```

**Get agent dependencies**:
```bash
jq '.components.agents[] | select(.id == "opencoder") | .dependencies[]?' registry.json
```

---

## Delegation

This command delegates to an analysis agent to perform the work:

```javascript
task(
  subagent_type="PatternAnalyst",
  description="Analyze context dependencies",
  prompt=`
    Analyze context file usage across all agents in this repository.
    
    TASK:
    1. Use grep to find all references to context files in:
       - .opencode/agent/**/*.md
       - .opencode/command/**/*.md
    
    2. Search for these patterns:
       - "/Users/apple/.config/opencode/context/core/" (direct paths)
       - "@/Users/apple/.config/opencode/context/" (@ references)
       - "context:" in frontmatter (dependency declarations)
    
    3. For each agent file found:
       - Extract agent ID from frontmatter
       - List all context files it references
       - Check registry.json for declared dependencies
       - Identify missing dependency declarations
    
    4. For each context file in /Users/apple/.config/opencode/context/core/:
       - Count how many agents reference it
       - Check if it exists in registry.json
       - Identify unused context files
    
    5. Generate a comprehensive report showing:
       - Agents with missing context dependencies
       - Unused context files
       - Missing context files (referenced but don't exist)
       - Context file usage map (which agents use which files)
    
    ${ARGUMENTS.includes('--fix') ? `
    6. AUTO-FIX MODE:
       - Update agent frontmatter to add missing context dependencies
       - Use format: context:core/standards/code
       - Preserve existing dependencies
       - Show what was changed
    ` : ''}
    
    ${ARGUMENTS.includes('--verbose') ? `
    VERBOSE MODE: Include all reference locations (file:line) in report
    ` : ''}
    
    ${ARGUMENTS.length > 0 && !ARGUMENTS.includes('--') ? `
    FILTER: Only analyze agent: ${ARGUMENTS[0]}
    ` : ''}
    
    REPORT FORMAT:
    - Summary statistics
    - Missing dependencies by agent (with recommended fixes)
    - Unused context files
    - Context file usage map
    - Next steps
    
    DO NOT make changes without --fix flag.
    ALWAYS show what would be changed before applying fixes.
  `
)
```

---

## Examples

### Example 1: Basic Analysis

```bash
/check-context-deps
```

**Output**:
```
Analyzing context file usage across 25 agents...

Found 8 agents with missing context dependencies:
- opencoder: missing context:core/standards/code
- openagent: missing 5 context dependencies
- frontend-specialist: missing context:core/standards/code
...

Run /check-context-deps --fix to auto-update frontmatter
```

### Example 2: Analyze Specific Agent

```bash
/check-context-deps contextscout
```

**Output**:
```
Analyzing agent: contextscout

Context files referenced:
✓ /Users/apple/.config/opencode/context/core/context-system.md (1 reference)
  - Line 15: "Load: context:core/context-system"
✓ /Users/apple/.config/opencode/context/core/context-system/standards/mvi.md (2 references)
  - Line 16: "Load: context:core/context-system/standards/mvi"
  - Line 89: "MVI-aware prioritization"

Registry dependencies:
✓ context:core/context-system DECLARED
✓ context:core/context-system/standards/mvi DECLARED

All dependencies properly declared ✅
```

### Example 3: Auto-Fix

```bash
/check-context-deps --fix
```

**Output**:
```
Analyzing and fixing context dependencies...

Updated opencoder:
+ Added: context:core/standards/code

Updated openagent:
+ Added: context:core/standards/code
+ Added: context:core/standards/docs
+ Added: context:core/standards/tests
+ Added: context:core/workflows/review
+ Added: context:core/workflows/delegation

Total: 2 agents updated, 6 dependencies added

Next: Run ./scripts/registry/auto-detect-components.sh to update registry
```

---

## Success Criteria

✅ All agents that reference context files have them declared in dependencies
✅ All context files in registry are actually used by at least one agent
✅ No broken references (context files referenced but don't exist)
✅ Dependency format is consistent (`context:path/to/file`)

---

## Notes

- **Read-only by default** - Only reports findings, doesn't modify files
- **Use `--fix` to update** - Auto-adds missing dependencies to frontmatter
- **After fixing** - Run `./scripts/registry/auto-detect-components.sh --auto-add` to sync registry
- **Dependency format** - `context:path/to/file` (no `.opencode/` prefix, no `.md` extension)
- **Scans both** - Direct path references and @ references

## Related

- **Registry validation**: `./scripts/registry/validate-registry.sh`
- **Auto-detect components**: `./scripts/registry/auto-detect-components.sh`
- **Context guide**: `/Users/apple/.config/opencode/context/openagents-repo/quality/registry-dependencies.md`
