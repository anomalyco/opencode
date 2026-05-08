<!-- Context: workflows/design-iteration-stage-layout | Priority: high | Version: 1.0 | Updated: 2025-12-09 -->
# Stage 1: Layout Design

**Purpose**: Define the structure and component hierarchy before visual design

## Process

1. Read design plan file from `.tmp/design-plans/{name}.md`
2. Analyze user requirements from plan
3. Identify core UI components
4. Plan layout structure and responsive behavior
5. Create ASCII wireframe
6. **Update plan file** with layout structure and component breakdown
7. Present to user for approval
8. **Update plan file** with user feedback and approval status

## Deliverable

- ASCII wireframe with component breakdown
- Updated plan file with Stage 1 complete

## Example Output

```
## Core UI Components

**Header Area**
- Logo/brand (Top left)
- Navigation menu (Top center)
- User actions (Top right)

**Main Content Area**
- Hero section (Full width)
- Feature cards (3-column grid on desktop, stack on mobile)
- Call-to-action (Centered)

**Footer**
- Links (4-column grid)
- Social icons (Centered)
- Copyright (Bottom)

## Layout Structure

Desktop (1024px+):
┌─────────────────────────────────────────────────┐
│ [Logo]        Navigation        [User Menu]     │
├─────────────────────────────────────────────────┤
│                                                 │
│              HERO SECTION                       │
│         (Full width, centered text)             │
│                                                 │
├─────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Card 1  │  │ Card 2  │  │ Card 3  │         │
│  │         │  │         │  │         │         │
│  └─────────┘  └─────────┘  └─────────┘         │
├─────────────────────────────────────────────────┤
│              [Call to Action]                   │
├─────────────────────────────────────────────────┤
│  Links    Links    Links    Social              │
│                    Copyright                    │
└─────────────────────────────────────────────────┘

Mobile (< 768px):
┌─────────────────┐
│ ☰  Logo   [👤]  │
├─────────────────┤
│                 │
│  HERO SECTION   │
│                 │
├─────────────────┤
│  ┌───────────┐  │
│  │  Card 1   │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  Card 2   │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  Card 3   │  │
│  └───────────┘  │
├─────────────────┤
│      [CTA]      │
├─────────────────┤
│     Links       │
│     Social      │
│   Copyright     │
└─────────────────┘
```

## Best Practices

✅ **Do**:
- Use ASCII wireframes for clarity
- Break down into component hierarchy
- Plan responsive behavior upfront
- Consider mobile-first approach
- Get approval before proceeding

❌ **Don't**:
- Skip wireframing and jump to code
- Ignore responsive considerations
- Proceed without user approval
- Over-complicate initial layout

## Approval Gate

"Would you like to proceed with this layout or need modifications?"

---

## Related Files

- [Overview](./design-iteration-overview.md)
- [Design Plan File](./design-iteration-plan-file.md)
- [Stage 2: Theme](./design-iteration-stage-theme.md)
