# Changelog

## [Unreleased] — feat/on-demand-skill-picker

### Added

- `type: core | non-core` frontmatter field for SKILL.md files
- `skills.autoLoad` config option: `"all"` | `"core"` | `"none"` (default: `"all"`)
- Skill scanner: `scanAvailableSkills()` returning typed metadata
- Skill loader: `loadSkillContent()` for session-scoped preview
- Backend skill API group: `GET /skills`, `POST /skills/load`
- `/skills` slash command with SolidJS Dialog picker
- Core/Non-Core grouped sections in picker with typeahead filtering
- Session-loaded skill indicators (✓ marker) in picker list
- i18n strings for all new UI text

### Changed

- `session/system.ts`: skill injection now filtered by `autoLoad` + `type`

### Backward Compatible

- `autoLoad` defaults to `"all"` — zero behaviour change for existing users
- SKILL.md files with no `type` field default to `"non-core"` — no errors
