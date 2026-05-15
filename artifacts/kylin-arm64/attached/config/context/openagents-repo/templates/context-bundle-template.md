<!-- Context: openagents-repo/context-bundle-template | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Context Bundle Template

**Purpose**: Template for creating context bundles when delegating tasks to subagents

**Location**: `.tmp/context/{session-id}/bundle.md`

**Used by**: repo-manager agent when delegating to subagents

---

## Template

```markdown
# Context Bundle: {Task Name}

Session: {session-id}
Created: {ISO timestamp}
For: {subagent-name}
Status: in_progress

## Task Overview

{Brief description of what we're building/doing}

## User Request

{Original user request - what they asked for}

## Relevant Standards (Load These Before Starting)

**Core Standards**:
- `/Users/apple/.config/opencode/context/core/standards/code.md` → Modular, functional code patterns
- `/Users/apple/.config/opencode/context/core/standards/tests.md` → Testing requirements and TDD
- `/Users/apple/.config/opencode/context/core/standards/docs.md` → Documentation standards
- (example: `/Users/apple/.config/opencode/context/core/standards/patterns.md`) → Error handling, security patterns

**Core Workflows**:
- (example: `/Users/apple/.config/opencode/context/core/workflows/delegation.md`) → Delegation process
- (example: `/Users/apple/.config/opencode/context/core/workflows/task-breakdown.md`) → Task breakdown methodology
- (example: `/Users/apple/.config/opencode/context/core/workflows/review.md`) → Code review guidelines

## Repository-Specific Context (Load These Before Starting)

**Quick Start** (ALWAYS load first):
- `/Users/apple/.config/opencode/context/openagents-repo/quick-start.md` → Repo orientation and common commands

**Core Concepts** (Load based on task type):
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/agents.md` → How agents work
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/evals.md` → How testing works
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/registry.md` → How registry works
- `/Users/apple/.config/opencode/context/openagents-repo/core-concepts/categories.md` → How organization works

**Guides** (Load for specific workflows):
- `/Users/apple/.config/opencode/context/openagents-repo/guides/adding-agent-basics.md` → Step-by-step agent creation
- `/Users/apple/.config/opencode/context/openagents-repo/guides/testing-agent.md` → Testing workflow
- `/Users/apple/.config/opencode/context/openagents-repo/guides/updating-registry.md` → Registry workflow
- `/Users/apple/.config/opencode/context/openagents-repo/guides/debugging.md` → Troubleshooting

**Lookup** (Quick reference):
- `/Users/apple/.config/opencode/context/openagents-repo/lookup/file-locations.md` → Where everything is
- `/Users/apple/.config/opencode/context/openagents-repo/lookup/commands.md` → Command reference

## Key Requirements

{Extract key requirements from loaded context}

**From Standards**:
- {requirement 1 from standards/code.md}
- {requirement 2 from standards/tests.md}
- {requirement 3 from standards/docs.md}

**From Repository Context**:
- {requirement 1 from repo context}
- {requirement 2 from repo context}
- {requirement 3 from repo context}

**Naming Conventions**:
- {convention 1}
- {convention 2}

**File Structure**:
- {structure requirement 1}
- {structure requirement 2}

## Technical Constraints

{List technical constraints and limitations}

- {constraint 1 - e.g., "Must use TypeScript"}
- {constraint 2 - e.g., "Must follow category-based organization"}
- {constraint 3 - e.g., "Must include proper frontmatter metadata"}

## Files to Create/Modify

{List all files that need to be created or modified}

**Create**:
- `{file-path-1}` - {purpose and what it should contain}
- `{file-path-2}` - {purpose and what it should contain}

**Modify**:
- `{file-path-3}` - {what needs to be changed}
- `{file-path-4}` - {what needs to be changed}

## Success Criteria

{Define what "done" looks like - binary pass/fail conditions}

- [ ] {criteria 1 - e.g., "Agent file created with proper frontmatter"}
- [ ] {criteria 2 - e.g., "Eval tests pass"}
- [ ] {criteria 3 - e.g., "Registry validation passes"}
- [ ] {criteria 4 - e.g., "Documentation updated"}

## Validation Requirements

{How to validate the work}

**Scripts to Run**:
- `{validation-script-1}` - {what it validates}
- `{validation-script-2}` - {what it validates}

**Tests to Run**:
- `{test-command-1}` - {what it tests}
- `{test-command-2}` - {what it tests}

**Manual Checks**:
- {check 1}
- {check 2}

## Expected Output

{What the subagent should produce}

**Deliverables**:
- {deliverable 1}
- {deliverable 2}

**Format**:
- {format requirement 1}
- {format requirement 2}

## Progress Tracking

{Track progress through the task}

- [ ] Context loaded and understood
- [ ] {step 1}
- [ ] {step 2}
- [ ] {step 3}
- [ ] Validation passed
- [ ] Documentation updated

---

## Instructions for Subagent

{Specific, detailed instructions for the subagent}

**IMPORTANT**: 
1. Load ALL context files listed in "Relevant Standards" and "Repository-Specific Context" sections BEFORE starting work
2. Follow ALL requirements from the loaded context
3. Apply naming conventions and file structure requirements
4. Validate your work using the validation requirements
5. Update progress tracking as you complete steps

**Your Task**:
{Detailed description of what the subagent needs to do}

**Approach**:
{Suggested approach or methodology}

**Constraints**:
{Any additional constraints or notes}

**Questions/Clarifications**:
{Any questions the subagent should consider or clarifications needed}
```

---

## Usage Instructions

### When to Create a Context Bundle

Create a context bundle when:
- Delegating to any subagent
- Task requires coordination across multiple components
- Subagent needs project-specific context
- Task has complex requirements or constraints

### How to Create a Context Bundle

1. **Create session directory**:
   ```bash
   mkdir -p .tmp/context/{session-id}
   ```

2. **Copy template**:
   ```bash
   cp /Users/apple/.config/opencode/context/openagents-repo/templates/context-bundle-template.md \
      .tmp/context/{session-id}/bundle.md
   ```

3. **Fill in all sections**:
   - Replace all `{placeholders}` with actual values
   - List specific context files to load (with full paths)
   - Extract key requirements from loaded context
   - Define clear success criteria
   - Provide specific instructions

4. **Pass to subagent**:
   ```javascript
   task(
     subagent_type="subagents/core/{subagent}",
     description="Brief description",
     prompt="Load context from .tmp/context/{session-id}/bundle.md before starting.
             
             {Specific task instructions}
             
             Follow all standards and requirements in the context bundle."
   )
   ```

### Best Practices

**DO**:
- ✅ List context files with full paths (don't duplicate content)
- ✅ Extract key requirements from loaded context
- ✅ Define binary success criteria (pass/fail)
- ✅ Provide specific validation requirements
- ✅ Include clear instructions for subagent
- ✅ Track progress through the task

**DON'T**:
- ❌ Duplicate full context file content (just reference paths)
- ❌ Use vague success criteria ("make it good")
- ❌ Skip validation requirements
- ❌ Forget to list technical constraints
- ❌ Omit file paths for files to create/modify

### Example Context Bundle

See `/Users/apple/.config/opencode/context/openagents-repo/examples/context-bundle-example.md` for a complete example.

---

**Last Updated**: 2025-01-21  
**Version**: 1.0.0
