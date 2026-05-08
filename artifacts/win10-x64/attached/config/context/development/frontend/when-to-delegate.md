<!-- Context: development/frontend/when-to-delegate | Priority: high | Version: 1.0 | Updated: 2026-01-30 -->
# When to Delegate to Frontend Specialist

## Overview

Clear decision criteria for when to delegate frontend/UI work to the **frontend-specialist** subagent vs. handling it directly.

## Quick Reference

**Delegate to frontend-specialist when**:
- UI/UX design work (wireframes, themes, animations)
- Design system implementation
- Complex responsive layouts
- Animation and micro-interactions
- Visual design iterations

**Handle directly when**:
- Simple HTML/CSS edits
- Single component updates
- Bug fixes in existing UI
- Minor styling tweaks

---

## Decision Matrix

### ✅ DELEGATE to Frontend-Specialist

| Scenario | Why Delegate | Example |
|----------|--------------|---------|
| **New UI design from scratch** | Needs staged workflow (layout → theme → animation → implement) | "Create a landing page for our product" |
| **Design system work** | Requires ContextScout for standards, ExternalScout for UI libs | "Implement our design system with Tailwind + Shadcn" |
| **Complex responsive layouts** | Needs mobile-first approach across breakpoints | "Build a dashboard with sidebar, cards, and responsive grid" |
| **Animation implementation** | Requires animation patterns, performance optimization | "Add smooth transitions and micro-interactions to the UI" |
| **Multi-stage design iterations** | Needs versioning (design_iterations/ folder) | "Design a checkout flow with 3 steps" |
| **Theme creation** | Requires OKLCH colors, CSS custom properties | "Create a dark mode theme for the app" |
| **Component library integration** | Needs ExternalScout for current docs (Flowbite, Radix, etc.) | "Integrate Flowbite components into our app" |
| **Accessibility-focused UI** | Requires WCAG compliance, ARIA attributes | "Build an accessible form with proper labels and validation" |

### ⚠️ HANDLE DIRECTLY (Don't Delegate)

| Scenario | Why Direct | Example |
|----------|------------|---------|
| **Simple HTML edits** | Single file, straightforward change | "Change the button text from 'Submit' to 'Send'" |
| **Minor CSS tweaks** | Small styling adjustment | "Make the header padding 20px instead of 16px" |
| **Bug fixes** | Fixing existing code, not creating new design | "Fix the broken link in the footer" |
| **Content updates** | Changing text, images, or data | "Update the hero section copy" |
| **Single component updates** | Modifying one existing component | "Add a new prop to the Button component" |
| **Quick prototypes** | Throwaway code for testing | "Create a quick HTML mockup to test an idea" |

---

## Delegation Checklist

Before delegating to frontend-specialist, ensure:

- [ ] **Task is UI/design focused** (not backend, logic, or data)
- [ ] **Task requires design expertise** (layout, theme, animations)
- [ ] **Task benefits from staged workflow** (layout → theme → animation → implement)
- [ ] **Task needs context discovery** (design systems, UI libraries, standards)
- [ ] **User has approved the approach** (never delegate before approval)

---

## How to Delegate

### Step 1: Discover Context (Optional but Recommended)

If you're unsure what context the frontend-specialist will need:

```javascript
task(
  subagent_type="ContextScout",
  description="Find frontend design context",
  prompt="Find design system standards, UI component patterns, animation guidelines, and responsive breakpoint conventions for frontend work."
)
```

### Step 2: Propose Approach

Present a plan to the user:

```markdown
## Implementation Plan

**Task**: Create landing page with hero section, features grid, and CTA

**Approach**: Delegate to frontend-specialist subagent

**Why**: 
- Requires design system implementation
- Needs responsive layout across breakpoints
- Includes animations and micro-interactions
- Benefits from staged workflow (layout → theme → animation → implement)

**Context Needed**:
- Design system standards (ui/web/design-systems.md)
- UI styling standards (ui/web/ui-styling-standards.md)
- Animation patterns (ui/web/animation-patterns.md)

**Approval needed before proceeding.**
```

### Step 3: Get Approval

Wait for explicit user approval before delegating.

### Step 4: Delegate with Context

**For simple delegation** (no session needed):

```javascript
task(
  subagent_type="frontend-specialist",
  description="Create landing page design",
  prompt="Context to load:
  - /Users/apple/.config/opencode/context/ui/web/design-systems.md
  - /Users/apple/.config/opencode/context/ui/web/ui-styling-standards.md
  - /Users/apple/.config/opencode/context/ui/web/animation-basics.md
  
  Task: Create a landing page with:
  - Hero section with headline, subheadline, CTA button
  - Features grid (3 columns on desktop, 1 on mobile)
  - Smooth scroll animations
  
  Requirements:
  - Use Tailwind CSS + Flowbite
  - Mobile-first responsive design
  - Animations <400ms
  - Save to design_iterations/landing_1.html
  
  Follow your staged workflow:
  1. Layout (ASCII wireframe)
  2. Theme (CSS theme file)
  3. Animation (micro-interactions)
  4. Implement (HTML file)
  
  Request approval between each stage."
)
```

**For complex delegation** (with session):

Create session context file first, then delegate with session path.

---

## Common Patterns

### Pattern 1: New Landing Page

**Trigger**: User asks for a new landing page, marketing page, or product page

**Decision**: ✅ Delegate to frontend-specialist

**Why**: Requires full design workflow (layout, theme, animations, implementation)

**Example**:
```
User: "Create a landing page for our SaaS product"
You: [Propose approach] → [Get approval] → [Delegate to frontend-specialist]
```

### Pattern 2: Design System Implementation

**Trigger**: User wants to implement or update a design system

**Decision**: ✅ Delegate to frontend-specialist

**Why**: Needs ContextScout for standards, ExternalScout for UI library docs

**Example**:
```
User: "Implement our design system using Tailwind and Shadcn"
You: [Propose approach] → [Get approval] → [Delegate to frontend-specialist]
```

### Pattern 3: Component Library Integration

**Trigger**: User wants to integrate a UI component library (Flowbite, Radix, etc.)

**Decision**: ✅ Delegate to frontend-specialist

**Why**: Requires ExternalScout for current docs, proper integration patterns

**Example**:
```
User: "Add Flowbite components to our app"
You: [Propose approach] → [Get approval] → [Delegate to frontend-specialist]
```

### Pattern 4: Animation Work

**Trigger**: User wants animations, transitions, or micro-interactions

**Decision**: ✅ Delegate to frontend-specialist

**Why**: Requires animation patterns, performance optimization (<400ms)

**Example**:
```
User: "Add smooth animations to the dashboard"
You: [Propose approach] → [Get approval] → [Delegate to frontend-specialist]
```

### Pattern 5: Simple HTML Edit

**Trigger**: User wants to change text, fix a link, or update content

**Decision**: ⚠️ Handle directly (don't delegate)

**Why**: Simple edit, no design work needed

**Example**:
```
User: "Change the button text to 'Get Started'"
You: [Edit the HTML file directly]
```

### Pattern 6: CSS Bug Fix

**Trigger**: User reports a styling bug or broken layout

**Decision**: ⚠️ Handle directly (don't delegate)

**Why**: Bug fix, not new design work

**Example**:
```
User: "The header is overlapping the content on mobile"
You: [Read the CSS, fix the issue directly]
```

---

## Red Flags (Don't Delegate)

❌ **User just wants a quick fix** → Handle directly  
❌ **Task is backend/logic focused** → Wrong subagent (use coder-agent or handle directly)  
❌ **Task is a single line change** → Handle directly  
❌ **Task is content update** → Handle directly  
❌ **Task is testing/validation** → Wrong subagent (use tester)  
❌ **Task is code review** → Wrong subagent (use reviewer)  

---

## Green Flags (Delegate)

✅ **User wants a new UI design** → Delegate  
✅ **Task involves design systems** → Delegate  
✅ **Task requires responsive layouts** → Delegate  
✅ **Task includes animations** → Delegate  
✅ **Task needs UI library integration** → Delegate  
✅ **Task benefits from staged workflow** → Delegate  
✅ **Task requires design expertise** → Delegate  

---

## Frontend-Specialist Capabilities

**What it does well**:
- Create complete UI designs from scratch
- Implement design systems (Tailwind, Shadcn, Flowbite)
- Build responsive layouts (mobile-first)
- Add animations and micro-interactions
- Integrate UI component libraries
- Create themes with OKLCH colors
- Follow staged workflow (layout → theme → animation → implement)
- Version designs (design_iterations/ folder)

**What it doesn't do**:
- Backend logic or API integration
- Database queries or data processing
- Testing or validation
- Code review or refactoring
- Simple HTML/CSS edits (overkill)
- Content updates (just text changes)

---

## Context Files Frontend-Specialist Uses

The frontend-specialist will automatically load these via ContextScout:

**Design System**:
- `ui/web/design-systems.md` - Theme templates, color systems
- `ui/web/ui-styling-standards.md` - Tailwind, Flowbite, responsive design
- `ui/web/design-assets.md` - Images, icons, fonts

**Patterns**:
- `ui/web/animation-patterns.md` - Animation syntax, micro-interactions
- `development/frontend/react/react-patterns.md` - React patterns (if React project)

**Workflows**:
- `core/workflows/design-iteration-overview.md` - Design iteration workflow

---

## Best Practices

### Do's ✅

- ✅ **Propose before delegating** - Show user the plan first
- ✅ **Get approval** - Never delegate without user approval
- ✅ **Provide context** - List context files the subagent should load
- ✅ **Set clear requirements** - Specify design system, breakpoints, animations
- ✅ **Use staged workflow** - Let frontend-specialist follow its process
- ✅ **Trust the specialist** - It knows design patterns and best practices

### Don'ts ❌

- ❌ **Don't delegate simple edits** - Handle directly for efficiency
- ❌ **Don't skip approval** - Always get user sign-off first
- ❌ **Don't delegate backend work** - Wrong subagent
- ❌ **Don't micromanage** - Let the specialist follow its workflow
- ❌ **Don't delegate without context** - Provide context files to load
- ❌ **Don't delegate bug fixes** - Handle directly unless it's a design issue

---

## Examples

### Example 1: Landing Page (Delegate)

**User Request**: "Create a landing page for our SaaS product with a hero section, features, and pricing"

**Your Response**:
```markdown
## Implementation Plan

**Task**: Create SaaS landing page

**Approach**: Delegate to frontend-specialist subagent

**Why**:
- Requires full design workflow (layout, theme, animations)
- Needs responsive design across breakpoints
- Benefits from design system standards

**Context Needed**:
- Design system standards
- UI styling standards
- Animation patterns

**Approval needed before proceeding.**
```

**After Approval**:
```javascript
task(
  subagent_type="frontend-specialist",
  description="Create SaaS landing page",
  prompt="Context to load:
  - /Users/apple/.config/opencode/context/ui/web/design-systems.md
  - /Users/apple/.config/opencode/context/ui/web/ui-styling-standards.md
  - /Users/apple/.config/opencode/context/ui/web/animation-basics.md
  
  Task: Create a SaaS landing page with:
  - Hero section (headline, subheadline, CTA)
  - Features section (3-column grid)
  - Pricing section (3 tiers)
  - Footer
  
  Requirements:
  - Tailwind CSS + Flowbite
  - Mobile-first responsive
  - Smooth scroll animations
  - Modern design system
  
  Follow staged workflow and request approval between stages."
)
```

### Example 2: Button Text Change (Direct)

**User Request**: "Change the 'Submit' button to say 'Send Message'"

**Your Response**:
```markdown
I'll update the button text directly.
```

**Action**: Read the HTML file, edit the button text, done. No delegation needed.

---

### Example 3: Design System Implementation (Delegate)

**User Request**: "Implement our design system using Tailwind and Shadcn components"

**Your Response**:
```markdown
## Implementation Plan

**Task**: Implement design system with Tailwind + Shadcn

**Approach**: Delegate to frontend-specialist subagent

**Why**:
- Requires UI library integration (Shadcn)
- Needs ExternalScout for current Shadcn docs
- Benefits from design system standards

**Context Needed**:
- Design system standards
- UI styling standards
- External docs (Shadcn)

**Approval needed before proceeding.**
```

**After Approval**:
```javascript
task(
  subagent_type="frontend-specialist",
  description="Implement Tailwind + Shadcn design system",
  prompt="Context to load:
  - /Users/apple/.config/opencode/context/ui/web/design-systems.md
  - /Users/apple/.config/opencode/context/ui/web/ui-styling-standards.md
  
  Task: Implement design system using Tailwind CSS and Shadcn/ui
  
  Requirements:
  - Call ExternalScout for current Shadcn docs
  - Set up Tailwind config
  - Integrate Shadcn components
  - Create theme file with OKLCH colors
  - Document component usage
  
  Follow staged workflow and request approval between stages."
)
```

---

## Summary

**Delegate to frontend-specialist when**:
- New UI designs from scratch
- Design system implementation
- Complex responsive layouts
- Animation work
- UI library integration
- Multi-stage design iterations

**Handle directly when**:
- Simple HTML/CSS edits
- Bug fixes
- Content updates
- Single component updates
- Quick prototypes

**Always**:
- Propose approach first
- Get user approval
- Provide context files
- Trust the specialist's workflow

---

## Related Context

- **Frontend Specialist Agent** → `../../../agent/subagents/development/frontend-specialist.md`
- **Design Systems** → `../../ui/web/design-systems.md`
- **UI Styling Standards** → `../../ui/web/ui-styling-standards.md`
- **Animation Patterns** → `../../ui/web/animation-patterns.md`
- **Delegation Workflow** → `../../core/workflows/task-delegation-basics.md`
- **React Patterns** → `react/react-patterns.md`
