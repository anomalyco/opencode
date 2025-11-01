---
name: test-skill
description: A test skill to verify the skill system integration works correctly. Activate when testing the skill manager UI.
allowed-tools: [Read, Write, Grep, Glob]
---

# Test Skill

This is a test skill to verify that the skill system integration is working correctly.

## Purpose

This skill demonstrates:

- YAML frontmatter parsing
- Skill discovery from .codesurf/skills/
- Skill activation/deactivation
- Tool restrictions

## When to Use

Use this skill when:

- Testing the skill manager dialog
- Verifying skill discovery works
- Testing skill activation/deactivation

## Allowed Tools

This skill restricts tool usage to:

- Read - For reading files
- Write - For creating files
- Grep - For searching content
- Glob - For finding files
