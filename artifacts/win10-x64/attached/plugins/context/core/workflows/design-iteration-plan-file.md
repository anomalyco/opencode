<!-- Context: workflows/design-iteration-plan-file | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Design Plan File (MANDATORY)

**CRITICAL**: Before starting any design work, create a persistent design plan file.

**Location**: `.tmp/design-plans/{project-name}-{feature-name}.md`

**Purpose**: 
- Preserve design decisions across stages
- Allow user to review and edit the plan
- Maintain context for subagent calls
- Track design evolution and iterations

**When to Create**: 
- BEFORE Stage 1 (Layout Design)
- After understanding user requirements
- Before any design work begins

## Template

```markdown
---
project: {project-name}
feature: {feature-name}
created: {ISO timestamp}
updated: {ISO timestamp}
status: in_progress
current_stage: layout
---

# Design Plan: {Feature Name}

## User Requirements
{What the user asked for - verbatim or close paraphrase}

## Design Goals
- {goal 1}
- {goal 2}
- {goal 3}

## Target Audience
{Who will use this UI}

## Technical Constraints
- Framework: {Next.js, React, etc.}
- Responsive: {Yes/No}
- Accessibility: {WCAG level}
- Browser support: {Modern, IE11+, etc.}

---

## Stage 1: Layout Design

### Status
- [ ] Layout planned
- [ ] ASCII wireframe created
- [ ] User approved

### Layout Structure
{ASCII wireframe will be added here}

### Component Breakdown
{Component list will be added here}

### User Feedback
{User comments and requested changes}

---

## Stage 2: Theme Design

### Status
- [ ] Design system selected
- [ ] Color palette chosen
- [ ] Typography defined
- [ ] User approved

### Theme Details
{Theme specifications will be added here}

### User Feedback
{User comments and requested changes}

---

## Stage 3: Animation Design

### Status
- [ ] Micro-interactions defined
- [ ] Animation timing set
- [ ] User approved

### Animation Details
{Animation specifications will be added here}

### User Feedback
{User comments and requested changes}

---

## Stage 4: Implementation

### Status
- [ ] HTML structure complete
- [ ] CSS applied
- [ ] Animations implemented
- [ ] User approved

### Output Files
- HTML: {file path}
- CSS: {file path}
- Assets: {file paths}

### User Feedback
{Final comments and requested changes}

---

## Design Evolution

### Iteration 1
- Date: {timestamp}
- Changes: {what changed}
- Reason: {why it changed}

### Iteration 2
- Date: {timestamp}
- Changes: {what changed}
- Reason: {why it changed}
```

## Workflow Integration

1. **Create plan file** → Write to `.tmp/design-plans/{name}.md`
2. **Each stage** → Update plan file with decisions and user feedback
3. **User approval** → Edit plan file with approved decisions
4. **User requests changes** → Edit plan file with feedback, iterate
5. **Subagent calls** → Pass plan file path for context preservation
6. **Completion** → Plan file contains full design history

## Benefits

- ✅ Context preserved across subagent calls
- ✅ User can review and edit plan directly
- ✅ Design decisions documented
- ✅ Easy to iterate and refine
- ✅ Full design history tracked

---

## Stage 0: Create Design Plan (MANDATORY FIRST STEP)

**Purpose**: Create persistent plan file before any design work

**Process**:
1. Understand user requirements
2. Identify design goals and constraints
3. Create plan file at `.tmp/design-plans/{project-name}-{feature-name}.md`
4. Populate with user requirements and goals
5. Present plan file location to user
6. Proceed to Stage 1

**Deliverable**: Design plan file created and initialized

**Example**:
```
✅ Design plan created: .tmp/design-plans/saas-landing-page.md

You can review and edit this file at any time. All design decisions will be tracked here.

Ready to proceed to Stage 1 (Layout Design)?
```

**Approval Gate**: "Plan file created. Ready to start layout design?"

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Stage 1: Layout](./design-iteration-stage-layout.md)
- [Plan Iterations](./design-iteration-plan-iterations.md)
