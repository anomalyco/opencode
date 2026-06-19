# ADR 002: On-Demand Skill Loading via /skills Command

## Status

Accepted

## Context

All skills were injected into the system prompt at every session start,
consuming context window tokens regardless of relevance. There was no way
to browse or selectively load a single skill mid-session. The only workaround
(an fzf picker) required an external terminal window — broken UX.

## Decision

- Added optional `type: core | non-core` field to SKILL.md frontmatter
  (default: non-core — conservative, core is opt-in)
- Added `skills.autoLoad: "all" | "core" | "none"` config option
  (default: "all" — full backward compatibility)
- Built /skills SolidJS Dialog picker using @opencode-ai/ui primitives,
  matching the DialogSelectModel pattern
- Skills loaded via picker are session-scoped only — not persisted,
  not injected into system prompt
- Backend skill API group: GET /skills, POST /skills/load

## Alternatives Considered

- **fzf in bash tool** — Rejected: no TTY available in OpenCode's bash tool,
  keyboard input never reaches subprocess
- **Binary true/false autoLoad** — Rejected: too coarse, no middle ground
  for users who want engineering skills but not domain-specific ones
- **External terminal picker** — Rejected: breaks single-window workflow

## Consequences

### Positive

- Context window used only for skills relevant to the current task
- Users can discover skills they didn't know existed via the picker
- Backward compatible — existing users see zero behaviour change
- Core skills (engineering workflow) auto-load; domain skills on demand

### Negative

- Users must tag their SKILL.md files with `type: core` to use autoLoad: "core"
- The preview panel (width ≥ 120) is not yet implemented — deferred

## References

- skill-picker.tsx
- packages/core/src/v1/config/skills.ts
- packages/opencode/src/session/system.ts
