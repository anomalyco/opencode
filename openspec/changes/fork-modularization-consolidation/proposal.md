# Reduce opencode-skein downstream patch surface

## Context
Current manifest has 17 owned files and 7 patched files. Patch surface is acceptable but can be improved. After upstream sync, consolidate Skein capabilities behind narrow integration points.

## Goals
- Move fork-specific logic into fork-owned modules under packages/opencode/src/fork/*
- Reduce number of patched upstream files
- Consolidate overlapping capabilities: loop, scheduler, automation, auto-reply, hooks, pattern detection
- Ensure each capability has explicit disposition: retained, adapted, consolidated, replaced, removed
- Add behavioral verification beyond marker strings

## Non-goals
- Change Skein user-facing behavior without review
- Rebase history

## Success criteria
- Patch surface reduced vs pre-sync
- fork/manifest.json updated with capability metadata
- Behavioral tests exist for critical capabilities
- FORK_WORKFLOW.md updated
