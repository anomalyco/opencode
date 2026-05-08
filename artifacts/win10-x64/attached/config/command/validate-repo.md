# Validate Repository

Comprehensive validation command that checks the entire OpenAgents Control repository for consistency between CLI, documentation, registry, and components.

## Usage

```bash
/validate-repo
```

## What It Checks

This command performs a comprehensive validation of:

1. **Registry Integrity**
   - JSON syntax validation
   - Component definitions completeness
   - File path references
   - Dependency declarations

2. **Component Existence**
   - All agents exist at specified paths
   - All subagents exist at specified paths
   - All commands exist at specified paths
   - All tools exist at specified paths
   - All plugins exist at specified paths
   - All context files exist at specified paths
   - All config files exist at specified paths

3. **Profile Consistency**
   - Component counts match documentation
   - Profile descriptions are accurate
   - Dependencies are satisfied
   - No duplicate components

4. **Documentation Accuracy**
   - README component counts match registry
   - OpenAgent documentation references are valid
   - Context file references are correct
   - Installation guide is up to date

5. **Context File Structure**
   - All referenced context files exist
   - Context file organization is correct
   - No orphaned context files

6. **Cross-References**
   - Agent dependencies exist
   - Subagent references are valid
   - Command references are valid
   - Tool dependencies are satisfied

## Output

The command generates a detailed report showing:
- ✅ What's correct and validated
- ⚠️ Warnings for potential issues
- ❌ Errors that need fixing
- 📊 Summary statistics

## Instructions

You are a validation specialist. Your task is to comprehensively validate the OpenAgents Control repository for consistency and correctness.

### Step 1: Validate Registry JSON

1. Read and parse `registry.json`
2. Validate JSON syntax
3. Check schema structure:
   - `version` field exists
   - `repository` field exists
   - `categories` object exists
   - `components` object exists with all types
   - `profiles` object exists
   - `metadata` object exists

### Step 2: Validate Component Definitions

For each component type (agents, subagents, commands, tools, plugins, contexts, config):

1. Check required fields:
   - `id` (unique)
   - `name`
   - `type`
   - `path`
   - `description`
   - `tags` (array)
   - `dependencies` (array)
   - `category`

2. Verify file exists at `path`
3. Check for duplicate IDs
4. Validate category is in defined categories

### Step 3: Validate Profiles

For each profile (essential, developer, business, full, advanced):

1. Count components in profile
2. Verify all component references exist in components section
3. Check dependencies are satisfied
4. Validate no duplicate components

### Step 4: Cross-Reference with Documentation

1. **navigation.md**:
   - Extract component counts from profile descriptions
   - Compare with actual registry counts
   - Check profile descriptions match registry descriptions

2. **docs/agents/openagent.md**:
   - Verify delegation criteria mentioned
   - Check context file references
   - Validate workflow descriptions

3. **docs/getting-started/installation.md**:
   - Check profile descriptions
   - Verify installation commands

### Step 5: Validate Context File Structure

1. List all files in `/Users/apple/.config/opencode/context/`
2. Check against registry context entries
3. Identify orphaned files (exist but not in registry)
4. Identify missing files (in registry but don't exist)
5. Validate structure:
   - `core/standards/` files
   - `core/workflows/` files
   - `core/system/` files
   - `project/` files

### Step 6: Validate Dependencies

For each component with dependencies:

1. Parse dependency string (format: `type:id`)
2. Verify referenced component exists
3. Check for circular dependencies
4. Validate dependency chain completeness

### Step 7: Generate Report

Create a comprehensive report with sections:

#### ✅ Validated Successfully
- Registry JSON syntax
- Component file existence
- Profile integrity
- Documentation accuracy
- Context file structure
- Dependency chains

#### ⚠️ Warnings
- Orphaned files (exist but not referenced)
- Unused components (defined but not in any profile)
- Missing descriptions or tags
- Outdated metadata dates

#### ❌ Errors
- Missing files
- Broken dependencies
- Invalid JSON
- Component count mismatches
- Broken documentation references
- Duplicate component IDs

#### 📊 Statistics
- Total components: X
- Total profiles: X
- Total context files: X
- Components per profile breakdown
- File coverage percentage

### Step 8: Provide Recommendations

Based on findings, suggest:
- Files to create
- Registry entries to add/remove
- Documentation to update
- Dependencies to fix

## Example Report Format

```markdown
# OpenAgents Control Repository Validation Report

Generated: 2025-11-19 14:30:00

## Summary

✅ 95% validation passed
⚠️ 3 warnings found
❌ 2 errors found

---

## ✅ Validated Successfully

### Registry Integrity
✅ JSON syntax valid
✅ All required fields present
✅ Schema structure correct

### Component Existence (45/47 files found)
✅ Agents: 3/3 files exist
✅ Subagents: 15/15 files exist
✅ Commands: 8/8 files exist
✅ Tools: 2/2 files exist
✅ Plugins: 2/2 files exist
✅ Contexts: 13/15 files exist
✅ Config: 2/2 files exist

### Profile Consistency
✅ Essential: 9 components (matches README)
✅ Developer: 29 components (matches README)
✅ Business: 15 components (matches README)
✅ Full: 35 components (matches README)
✅ Advanced: 42 components (matches README)

### Documentation Accuracy
✅ README component counts match registry
✅ OpenAgent documentation up to date
✅ Installation guide accurate

---

## ⚠️ Warnings (3)

1. **Orphaned Context File**
   - File: `/Users/apple/.config/opencode/context/legacy/old-patterns.md`
   - Issue: Exists but not referenced in registry
   - Recommendation: Add to registry or remove file

2. **Unused Component**
   - Component: `workflow-orchestrator` (agent)
   - Issue: Defined in registry but not in any profile
   - Recommendation: Add to a profile or mark as deprecated

3. **Outdated Metadata**
   - Field: `metadata.lastUpdated`
   - Current: 2025-11-15
   - Recommendation: Update to current date

---

## ❌ Errors (2)

1. **Missing Context File**
   - Component: `context:advanced-patterns`
   - Expected path: `/Users/apple/.config/opencode/context/core/advanced-patterns.md`
   - Referenced in: developer, full, advanced profiles
   - Action: Create file or remove from registry

2. **Broken Dependency**
   - Component: `agent:opencoder`
   - Dependency: `subagent:pattern-matcher`
   - Issue: Dependency not found in registry
   - Action: Add missing subagent or fix dependency reference

---

## 📊 Statistics

### Component Distribution
- Agents: 3
- Subagents: 15
- Commands: 8
- Tools: 2
- Plugins: 2
- Contexts: 15
- Config: 2
- **Total: 47 components**

### Profile Breakdown
- Essential: 9 components (19%)
- Developer: 29 components (62%)
- Business: 15 components (32%)
- Full: 35 components (74%)
- Advanced: 42 components (89%)

### File Coverage
- Total files defined: 47
- Files found: 45 (96%)
- Files missing: 2 (4%)
- Orphaned files: 1

### Dependency Health
- Total dependencies: 23
- Valid dependencies: 22 (96%)
- Broken dependencies: 1 (4%)
- Circular dependencies: 0

---

## 🔧 Recommended Actions

### High Priority (Errors)
1. Create missing file: `/Users/apple/.config/opencode/context/core/advanced-patterns.md`
2. Fix broken dependency in `opencoder`

### Medium Priority (Warnings)
1. Remove orphaned file or add to registry
2. Add `workflow-orchestrator` to a profile or deprecate
3. Update metadata.lastUpdated to 2025-11-19

### Low Priority (Improvements)
1. Add more tags to components for better searchability
2. Consider adding descriptions to all context files
3. Document component categories in README

---

## Next Steps

1. Review and fix all ❌ errors
2. Address ⚠️ warnings as needed
3. Re-run validation to confirm fixes
4. Update documentation if needed

---

**Validation Complete** ✓
```

## Implementation Notes

The command should:
- Use bash/python for file system operations
- Parse JSON with proper error handling
- Generate markdown report
- Be non-destructive (read-only validation)
- Provide actionable recommendations
- Support verbose mode for detailed output

## Error Handling

- Gracefully handle missing files
- Continue validation even if errors found
- Collect all issues before reporting
- Provide clear error messages with context

## Performance

- Should complete in < 30 seconds
- Cache file reads where possible
- Parallel validation where safe
- Progress indicators for long operations
