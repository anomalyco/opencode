<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: GitHub Issues and Project Board Workflow

**Prerequisites**: Basic understanding of GitHub issues and projects  
**Purpose**: Step-by-step workflow for managing issues and project board

---

## Overview

This guide covers how to work with GitHub issues and the project board to track and process different requests, features, and improvements.

**Project Board**: https://github.com/users/darrenhinde/projects/2/views/2

**Time**: Varies by task

---

## Quick Commands Reference

```bash
# List issues
gh issue list --repo darrenhinde/OpenAgentsControl

# Create issue
gh issue create --repo darrenhinde/OpenAgentsControl --title "Title" --body "Body" --label "label1,label2"

# Add issue to project
gh project item-add 2 --owner darrenhinde --url https://github.com/darrenhinde/OpenAgentsControl/issues/NUMBER

# View issue
gh issue view NUMBER --repo darrenhinde/OpenAgentsControl

# Update issue
gh issue edit NUMBER --repo darrenhinde/OpenAgentsControl --add-label "new-label"

# Close issue
gh issue close NUMBER --repo darrenhinde/OpenAgentsControl
```

---

## Step 1: Creating Issues

### Issue Types

**Feature Request**
- Labels: `feature`, `enhancement`
- Include: Goals, key features, success criteria
- Template: See "Feature Issue Template" below

**Bug Report**
- Labels: `bug`
- Include: Steps to reproduce, expected vs actual behavior
- Template: See "Bug Issue Template" below

**Improvement**
- Labels: `enhancement`, `framework`
- Include: Current state, proposed improvement, impact

**Question**
- Labels: `question`
- Include: Context, specific question, use case

### Priority Labels

- `priority-high` - Critical, blocking work
- `priority-medium` - Important, not blocking
- `priority-low` - Nice to have

### Category Labels

- `agents` - Agent system related
- `framework` - Core framework changes
- `evals` - Evaluation framework
- `idea` - High-level proposal

### Creating an Issue

```bash
# Basic issue
gh issue create \
  --repo darrenhinde/OpenAgentsControl \
  --title "Add new feature X" \
  --body "Description of feature" \
  --label "feature,priority-medium"

# Feature with detailed body
gh issue create \
  --repo darrenhinde/OpenAgentsControl \
  --title "Build plugin system" \
  --label "feature,framework,priority-high" \
  --body "$(cat <<'EOF'
## Overview
Brief description

## Goals
- Goal 1
- Goal 2

## Key Features
- Feature 1
- Feature 2

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
EOF
)"
```

---

## Step 2: Adding Issues to Project Board

### Add Single Issue

```bash
# Add issue to project
gh project item-add 2 \
  --owner darrenhinde \
  --url https://github.com/darrenhinde/OpenAgentsControl/issues/NUMBER
```

### Add Multiple Issues

```bash
# Add issues 137-142 to project
for i in {137..142}; do
  gh project item-add 2 \
    --owner darrenhinde \
    --url https://github.com/darrenhinde/OpenAgentsControl/issues/$i
done
```

### Verify Issues on Board

```bash
# View project items
gh project item-list 2 --owner darrenhinde --format json | jq '.items[] | {title, status}'
```

---

## Step 3: Processing Issues

### Workflow States

1. **Backlog** - New issues, not yet prioritized
2. **Todo** - Prioritized, ready to work on
3. **In Progress** - Currently being worked on
4. **In Review** - PR submitted, awaiting review
5. **Done** - Completed and merged

### Moving Issues

```bash
# Update issue status (via project board UI or gh CLI)
# Note: Status updates are typically done via web UI
```

### Assigning Issues

```bash
# Assign to yourself
gh issue edit NUMBER \
  --repo darrenhinde/OpenAgentsControl \
  --add-assignee @me

# Assign to someone else
gh issue edit NUMBER \
  --repo darrenhinde/OpenAgentsControl \
  --add-assignee username
```

---

## Step 4: Working on Issues

### Start Work

1. **Assign issue to yourself**
   ```bash
   gh issue edit NUMBER --repo darrenhinde/OpenAgentsControl --add-assignee @me
   ```

2. **Move to "In Progress"** (via web UI)

3. **Create branch** (optional)
   ```bash
   git checkout -b feature/issue-NUMBER-description
   ```

4. **Reference issue in commits**
   ```bash
   git commit -m "feat: implement X (#NUMBER)"
   ```

### Update Progress

```bash
# Add comment to issue
gh issue comment NUMBER \
  --repo darrenhinde/OpenAgentsControl \
  --body "Progress update: Completed X, working on Y"
```

### Complete Work

1. **Create PR**
   ```bash
   gh pr create \
     --repo darrenhinde/OpenAgentsControl \
     --title "Fix #NUMBER: Description" \
     --body "Closes #NUMBER\n\nChanges:\n- Change 1\n- Change 2"
   ```

2. **Move to "In Review"** (via web UI)

3. **After merge, issue auto-closes** (if PR uses "Closes #NUMBER")

---

## Step 5: Using Issues for Request Processing

### Request Types

**User Feature Request**
1. Create issue with `feature` label
2. Add to project board
3. Prioritize based on impact
4. Break down into subtasks if needed
5. Assign to appropriate person/team

**Bug Report**
1. Create issue with `bug` label
2. Add reproduction steps
3. Prioritize based on severity
4. Assign for investigation
5. Link to related issues if applicable

**Improvement Suggestion**
1. Create issue with `enhancement` label
2. Discuss approach in comments
3. Get consensus before implementation
4. Create implementation plan
5. Execute and track progress

### Breaking Down Large Issues

For complex features, create parent issue and subtasks:

```bash
# Parent issue
gh issue create \
  --repo darrenhinde/OpenAgentsControl \
  --title "[EPIC] Plugin System" \
  --label "feature,framework,priority-high" \
  --body "Parent issue for plugin system work"

# Subtask issues
gh issue create \
  --repo darrenhinde/OpenAgentsControl \
  --title "Plugin manifest system" \
  --label "feature" \
  --body "Part of #PARENT_NUMBER\n\nImplement plugin.json manifest"
```

---

## Step 6: Issue Templates

### Feature Issue Template

```markdown
## Overview
Brief description of the feature

## Goals
- Goal 1
- Goal 2
- Goal 3

## Key Features
- Feature 1
- Feature 2
- Feature 3

## Related Issues
- #123 (related issue)

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

### Bug Issue Template

```markdown
## Description
Brief description of the bug

## Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: macOS/Linux/Windows
- Version: 0.5.2
- Node: v20.x

## Additional Context
Any other relevant information
```

### Improvement Issue Template

```markdown
## Current State
Description of current implementation

## Proposed Improvement
What should be improved and why

## Impact
- Performance improvement
- Developer experience
- User experience

## Implementation Approach
High-level approach to implementation

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

---

## Step 7: Automation and Integration

### Auto-Close Issues

Use keywords in PR descriptions:
- `Closes #123`
- `Fixes #123`
- `Resolves #123`

### Link Issues to PRs

```bash
# In PR description
gh pr create \
  --title "Add feature X" \
  --body "Implements #123\n\nChanges:\n- Change 1"
```

### Issue References in Commits

```bash
# Reference issue in commit
git commit -m "feat: add plugin system (#137)"

# Close issue in commit
git commit -m "fix: resolve permission error (closes #140)"
```

---

## Best Practices

### Issue Creation

✅ **Clear titles** - Descriptive and specific  
✅ **Detailed descriptions** - Include context and goals  
✅ **Proper labels** - Use consistent labeling  
✅ **Success criteria** - Define what "done" means  
✅ **Link related issues** - Show dependencies  

### Issue Management

✅ **Regular triage** - Review and prioritize weekly  
✅ **Keep updated** - Add comments on progress  
✅ **Close stale issues** - Clean up old/irrelevant issues  
✅ **Use milestones** - Group related issues  
✅ **Assign owners** - Clear responsibility  

### Project Board

✅ **Update status** - Keep board current  
✅ **Limit WIP** - Don't overload "In Progress"  
✅ **Review regularly** - Weekly board review  
✅ **Archive completed** - Keep board clean  

---

## Common Workflows

### Processing User Request

1. **Receive request** (via issue, email, chat)
2. **Create issue** with appropriate labels
3. **Add to project board**
4. **Triage and prioritize**
5. **Assign to team member**
6. **Track progress** via status updates
7. **Review and merge** PR
8. **Close issue** and notify requester

### Planning New Feature

1. **Create epic issue** for overall feature
2. **Break down into subtasks**
3. **Add all to project board**
4. **Prioritize subtasks**
5. **Assign to team members**
6. **Track progress** across subtasks
7. **Complete and close** when all subtasks done

### Bug Triage

1. **Create bug issue** with reproduction steps
2. **Label with severity** (critical, high, medium, low)
3. **Add to project board**
4. **Assign for investigation**
5. **Reproduce and diagnose**
6. **Fix and test**
7. **Create PR** with fix
8. **Close issue** after merge

---

## Checklist

Before closing an issue:

- [ ] All success criteria met
- [ ] Tests passing
- [ ] Documentation updated
- [ ] PR merged (if applicable)
- [ ] Related issues updated
- [ ] Stakeholders notified

---

## Related Files

- **Registry guide**: `guides/updating-registry.md`
- **Release guide**: `guides/creating-release.md`
- **Testing guide**: `guides/testing-agent.md`
- **Debugging**: `guides/debugging.md`

---

## External Resources

- [GitHub Issues Documentation](https://docs.github.com/en/issues)
- [GitHub Projects Documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

---

**Last Updated**: 2026-01-30  
**Version**: 0.5.2
