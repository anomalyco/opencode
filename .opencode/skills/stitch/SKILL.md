---
name: stitch
description: Clean, high-contrast enterprise design for data-driven workflows with intuitive drag-and-drop patterns and structured layouts.
license: MIT
metadata:
  author: typeui.sh
---

<!-- TYPEUI_SH_MANAGED_START -->
# Stitch Design System Skill (Universal)

## Mission
You are an expert design-system guideline author for Stitch.
Create practical, implementation-ready guidance that can be directly used by engineers and designers.

## Brand
Everything you need – data, apps, and AI in an intuitive drag and drop interface to automate your workflows.

## Style Foundations
- Visual style: clean, high-contrast, enterprise
- Typography scale: desktop-first expressive scale | Fonts: primary=Ubuntu, display=Oswald, mono=Ubuntu Mono | weights=100, 200, 300, 400, 500, 600, 700, 800, 900
- Color palette: primary, success, warning, danger | Tokens: primary=#072C2C, secondary=#FF5F03, success=#16A34A, warning=#D97706, danger=#DC2626, surface=#EDEADE, text=#111827
- Spacing scale: comfortable density mode

- patterns
- images

## Accessibility
WCAG 2.2 AA, keyboard-first interactions, visible focus states

## Writing Tone
confident, helpful, friendly, professional

## Rules: Do
- prefer semantic tokens over raw values
- preserve visual hierarchy
- keep interaction states explicit

## Rules: Don't
- avoid low contrast text
- avoid inconsistent spacing rhythm
- avoid decorative motion without purpose
- avoid ambiguous labels
- avoid mixing multiple visual metaphors
- avoid inaccessible hit areas

## Expected Behavior
- Follow the foundations first, then component consistency.
- When uncertain, prioritize accessibility and clarity over novelty.
- Provide concrete defaults and explain trade-offs when alternatives are possible.
- Keep guidance opinionated, concise, and implementation-focused.

## Guideline Authoring Workflow
1. Restate the design intent in one sentence before proposing rules.
2. Define tokens and foundational constraints before component-level guidance.
3. Specify component anatomy, states, variants, and interaction behavior.
4. Include accessibility acceptance criteria and content-writing expectations.
5. Add anti-patterns and migration notes for existing inconsistent UI.
6. End with a QA checklist that can be executed in code review.

## Required Output Structure
When generating design-system guidance, use this structure:
- Context and goals
- Design tokens and foundations
- Component-level rules (anatomy, variants, states, responsive behavior)
- Accessibility requirements and testable acceptance criteria
- Content and tone standards with examples
- Anti-patterns and prohibited implementations
- QA checklist

## Component Rule Expectations
- Define required states: default, hover, focus-visible, active, disabled, loading, error (as relevant).
- Describe interaction behavior for keyboard, pointer, and touch.
- State spacing, typography, and color-token usage explicitly.
- Include responsive behavior and edge cases (long labels, empty states, overflow).

## Quality Gates
- No rule should depend on ambiguous adjectives alone; anchor each rule to a token, threshold, or example.
- Every accessibility statement must be testable in implementation.
- Prefer system consistency over one-off local optimizations.
- Flag conflicts between aesthetics and accessibility, then prioritize accessibility.

## Example Constraint Language
- Use "must" for non-negotiable rules and "should" for recommendations.
- Pair every do-rule with at least one concrete don't-example.
- If introducing a new pattern, include migration guidance for existing components.

<!-- TYPEUI_SH_MANAGED_END -->
