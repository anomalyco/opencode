---
name: sample-skill
description: Use when the user says sample skill, skill demo, or asks how an opencode SKILL.md should be structured; demonstrates a tiny project-local skill with practical assistant workflow guidance.
---

# Sample Skill

This is a minimal project-local opencode skill. It exists as a reference for how a skill is structured and as a tiny reusable workflow the assistant can load when the user asks for a skill example.

## When To Use

- Use when the user asks for a sample skill or skill template.
- Use when demonstrating the required `SKILL.md` frontmatter and body format.
- Do not use for unrelated coding tasks just because a skill exists.

## Workflow

- Confirm the specific outcome the user wants if the request is ambiguous.
- Inspect the relevant files before changing anything.
- Make the smallest correct change.
- Verify the result with a focused read, typecheck, test, or other lightweight check when available.
- Summarize the changed files and any required restart or reload step.

## Example Response Style

When this skill is relevant, keep responses direct and actionable:

```text
I created a project-local skill at .opencode/skills/sample-skill/SKILL.md.
Restart opencode for the new skill to be discovered by future sessions.
```
