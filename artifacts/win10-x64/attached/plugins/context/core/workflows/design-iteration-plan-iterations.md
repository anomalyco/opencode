<!-- Context: workflows/design-iteration-plan-iterations | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Handling Plan File Edits and Iterations

## User Edits Plan File Directly

**Scenario**: User opens `.tmp/design-plans/{name}.md` and makes changes

**Process**:
1. User edits plan file (changes requirements, adds constraints, modifies goals)
2. User notifies agent: "I've updated the plan file"
3. Agent reads updated plan file
4. Agent identifies what changed
5. Agent proposes how to incorporate changes
6. Agent updates affected stages

**Example**:
```
User: "I've updated the plan file - changed the color scheme to dark mode"

Agent: 
✅ Read updated plan: .tmp/design-plans/saas-landing-page.md

Changes detected:
- Color scheme: Light → Dark mode
- Primary color: Blue → Purple

This affects:
- Stage 2 (Theme) - needs regeneration
- Stage 4 (Implementation) - needs CSS update

Would you like me to:
1. Regenerate theme with dark mode
2. Update implementation with new theme
```

---

## Iteration Within a Stage

**Scenario**: User requests changes during a stage

**Process**:
1. Agent presents stage output (e.g., layout wireframe)
2. User requests changes: "Make the hero section taller"
3. Agent updates plan file with feedback
4. Agent makes changes
5. Agent updates plan file with new iteration
6. Agent presents updated output

**Example**:
```
Stage 1 - Layout Design

Agent: [presents wireframe]

User: "Make the hero section taller and move CTA above the fold"

Agent:
✅ Updated plan file with feedback
✅ Revised layout wireframe
✅ Updated plan file with Iteration 2

[presents updated wireframe]
```

---

## Tracking Iterations in Plan File

**Format**:
```markdown
## Design Evolution

### Iteration 1 - Initial Layout
- Date: 2026-01-30T10:00:00Z
- Stage: Layout
- Changes: Initial wireframe created
- User feedback: "Hero section too short, CTA below fold"

### Iteration 2 - Revised Layout
- Date: 2026-01-30T10:15:00Z
- Stage: Layout
- Changes: Increased hero height from 400px to 600px, moved CTA above fold
- User feedback: "Perfect! Approved."
- Status: ✅ Approved

### Iteration 3 - Theme Adjustment
- Date: 2026-01-30T10:30:00Z
- Stage: Theme
- Changes: Changed from light to dark mode, primary color blue → purple
- User feedback: "Love the dark mode!"
- Status: ✅ Approved
```

---

## Subagent Context Preservation

**Problem**: Subagents lose context between calls

**Solution**: Always pass plan file path

**Pattern**:
```javascript
// When delegating to subagent
task(
  subagent_type="OpenFrontendSpecialist",
  description="Implement Stage 4",
  prompt="Load design plan from .tmp/design-plans/saas-landing-page.md
  
  Read the plan file for:
  - All approved decisions from Stages 1-3
  - User requirements and constraints
  - Design evolution and iterations
  
  Implement Stage 4 (Implementation) following all approved decisions.
  
  Update the plan file with:
  - Output file paths
  - Implementation status
  - Any issues encountered"
)
```

---

## Plan File as Single Source of Truth

### Benefits

- ✅ All design decisions in one place
- ✅ User can review and edit anytime
- ✅ Subagents have full context
- ✅ Design history preserved
- ✅ Easy to iterate and refine
- ✅ No context loss between stages

### Best Practices

- Always read plan file at start of each stage
- Update plan file after every user interaction
- Track all iterations with timestamps
- Document user feedback verbatim
- Mark approved decisions clearly
- Pass plan file path to all subagents

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Design Plan File](./design-iteration-plan-file.md)
- [Best Practices](./design-iteration-best-practices.md)
