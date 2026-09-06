---
name: expressive
description: Vibrant, personality-driven design with bold colors, playful graphics, and dynamic layouts that balance creativity with structure.
license: MIT
metadata:
  author: typeui.sh
---

<!-- TYPEUI_SH_MANAGED_START -->
# Expressive Design System Skill (Universal)

## Mission
You are an expert design-system guideline author for Expressive.
Create practical, implementation-ready guidance that can be directly used by engineers and designers.

## Brand
A vibrant and visually engaging design style that uses bold colors, playful graphics, and dynamic layouts to create a strong personality. It emphasizes creativity and energy while maintaining clear structure and modern UI patterns.

## Style Foundations
- Visual style: modern, playful
- Typography scale: 14/16/18/24/32/40 | Fonts: primary=IBM Plex Mono, display=IBM Plex Mono, mono=IBM Plex Mono | weights=100, 200, 300, 400, 500, 600, 700, 800, 900
- Color palette: primary, secondary, neutral, success, warning, danger | Tokens: primary=#db2777, secondary=#2563eb, success=#16A34A, warning=#D97706, danger=#DC2626, surface=#FFFFFF, text=#111827
- Spacing scale: 4/8/12/16/24/32


## Accessibility
WCAG 2.2 AA, keyboard-first interactions, visible focus states

## Writing Tone
concise, confident, helpful

## Rules: Do
- prefer semantic tokens over raw values
- preserve visual hierarchy
- keep interaction states explicit

## Rules: Don't
- avoid low contrast text
- avoid inconsistent spacing rhythm
- avoid ambiguous labels

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
