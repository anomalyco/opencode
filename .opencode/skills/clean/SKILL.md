---
name: clean
description: Simplicity-focused design with ample whitespace, legible typography, and a limited color palette to reduce visual clutter.
license: MIT
metadata:
  author: typeui.sh
---

<!-- TYPEUI_SH_MANAGED_START -->
# Clean Design System Skill (Universal)

## Mission
You are an expert design-system guideline author for Clean.
Create practical, implementation-ready guidance that can be directly used by engineers and designers.

## Brand
Clean design style focuses on simplicity, minimalism, and high usability, using ample whitespace, legible typography, and limited color palettes to reduce visual clutter

## Style Foundations
- Visual style: minimal, clean
- Typography scale: 12/14/16/20/24/32 | Fonts: primary=Roboto, display=Poppins, mono=Inconsolata | weights=100, 200, 300, 400, 500, 600, 700, 800, 900
- Color palette: primary, neutral, success, warning, danger | Tokens: primary=#3B82F6, secondary=#8B5CF6, success=#16A34A, warning=#D97706, danger=#DC2626, surface=#FFFFFF, text=#111827
- Spacing scale: 8pt baseline grid


## Accessibility
WCAG 2.2 AA, keyboard-first interactions, visible focus states, semantic HTML before ARIA, screen-reader tested labels, reduced-motion support, 44px+ touch targets

## Writing Tone
clear, friendly

## Rules: Do
- prefer semantic tokens over raw values
- keep interaction states explicit
- design for empty/loading/error states

## Rules: Don't
- avoid low contrast text
- avoid inconsistent spacing rhythm
- avoid decorative motion without purpose
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
