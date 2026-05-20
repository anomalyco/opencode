<!-- Context: workflows/design-iteration-overview | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Design Iteration Workflow - Overview

## Overview

A structured 4-stage workflow for creating and iterating on UI designs. This process ensures thoughtful design decisions with user approval at each stage.

## Quick Reference

**Stages**: Layout → Theme → Animation → Implementation
**Approval**: Required between each stage
**Output**: Single HTML file per design iteration
**Location**: `design_iterations/` folder

---

## When to Use This Workflow

### Delegate to OpenFrontendSpecialist When:

**✅ STRONGLY RECOMMENDED** to delegate for:
- **New UI/UX design work** - Landing pages, dashboards, app interfaces
- **Design system creation** - Component libraries, theme systems, style guides
- **Complex layouts** - Multi-column grids, responsive designs, intricate structures
- **Visual polish** - Animations, transitions, micro-interactions
- **Brand-focused work** - Marketing pages, product showcases, hero sections
- **Accessibility-critical UI** - Forms, navigation, interactive components

**Why delegate?**
- OpenFrontendSpecialist follows the 4-stage design workflow (Layout → Theme → Animation → Implementation)
- Ensures thoughtful design decisions with approval gates
- Produces polished, accessible, production-ready UI
- Handles responsive design, OKLCH colors, semantic HTML
- Creates single-file HTML prototypes for quick iteration

### Execute Directly When:

**⚠️ Simple cases only**:
- Minor text/content updates to existing UI
- Small CSS tweaks (colors, spacing, fonts)
- Adding simple utility classes
- Updating existing component props
- Bug fixes in existing UI code

### Delegation Pattern

```javascript
// For UI design work
task(
  subagent_type="OpenFrontendSpecialist",
  description="Design {feature} UI",
  prompt="Design a {feature} following the 4-stage workflow:
  
  Requirements:
  - {requirement 1}
  - {requirement 2}
  
  Context: {what this UI is for}
  
  Follow the design iteration workflow:
  1. Layout (ASCII wireframe)
  2. Theme (design system, colors)
  3. Animation (micro-interactions)
  4. Implementation (single HTML file)
  
  Request approval between each stage."
)
```

### Example Scenarios

| Scenario | Action | Why |
|----------|--------|-----|
| "Create a landing page for our SaaS product" | ✅ Delegate to OpenFrontendSpecialist | Complex UI design, needs 4-stage workflow |
| "Design a user dashboard with charts" | ✅ Delegate to OpenFrontendSpecialist | Complex layout, visual design, interactions |
| "Build a component library with our brand" | ✅ Delegate to OpenFrontendSpecialist | Design system work, requires theme expertise |
| "Fix button color from blue to green" | ⚠️ Execute directly | Simple CSS change |
| "Update hero text content" | ⚠️ Execute directly | Content update only |

---

## Related Files

- [Design Plan File](./design-iteration-plan-file.md) - MANDATORY plan file template
- [Stage 1: Layout](./design-iteration-stage-layout.md)
- [Stage 2: Theme](./design-iteration-stage-theme.md)
- [Stage 3: Animation](./design-iteration-stage-animation.md)
- [Stage 4: Implementation](./design-iteration-stage-implementation.md)
- [Visual Content Generation](./design-iteration-visual-content.md)
- [Best Practices](./design-iteration-best-practices.md)
- [Plan Iterations](./design-iteration-plan-iterations.md)
