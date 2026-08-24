# Phase 1 Investigation Summary

## Baseline & Target
- Baseline upstreamRef: 8716c4309a209d50f0b17211e407e317a28cdce3 (2026-06-18)
- Current upstream/dev: d041eee55c4b669f583fcbe0eb73e78d53393ae8
- Commits ahead: 215, behind: 1208
- Files changed: 2206

## Major Architectural Eras Since Baseline

### 1. App/TUI Refactor
- packages/ui → packages/session-ui migration (100+ files renamed)
- packages/server groups → packages/protocol groups
- packages/app controller extraction: settings controllers, model selector, tab rename adapter, prompt effects moved into controller
- TUI config/keybind schema changes, new dialog components

### 2. Provider Architecture Evolution
- packages/core/src/plugin/provider/* expanded with many providers
- OpenAI compatible chat model updates
- GitHub Copilot responses support added
- Provider catalog hooks changed in packages/app

### 3. Session / Core
- Session ordering fixes: chronological message boundaries, legacy loop ordering
- Session compaction history serialization
- Session timeline and cursor improvements
- Effect pattern migration ongoing

### 4. i18n / RTL
- Minimal RTL support added, locale plural rules, translation coverage expanded
- Locale names kept native

### 5. Desktop / App UX
- Model provider sections collapsed, v2 sidecar opt-in
- Tab states refined, file tree fades, composer attachments disallowed duplicates
- Diff viewer refinements

## Impact on Fork Patches

### Patched files status
- packages/opencode/src/provider/provider.ts – exists, structure changed (LayerNode imports)
- packages/tui/src/component/dialog-provider.tsx – exists
- packages/tui/src/config/keybind.ts – exists but `dialog.local` keybind no longer present upstream
- packages/tui/src/context/theme.tsx – exists, ThemeState usage likely still valid
- packages/tui/src/feature-plugins/sidebar/context.tsx – exists
- packages/opencode/src/index.ts – exists
- packages/opencode/src/installation/index.ts – exists

### Known consistency problems
- FORK_WORKFLOW.md lists regressions for theme.tsx ThemeState.set – code currently present with createEffect
- cache_creation_tokens mentioned for packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts and packages/llm/src/protocols/openai-chat.ts – not found in current fork, likely upstream removed or renamed
- dialog.local keybind missing upstream → patch may be obsolete or need re-targeting

## Repository Hygiene
- graphify-out/ contains 2650 files, not in .gitignore → pollutes diffs
- Recommend adding /graphify-out/ to .gitignore and git rm --cached

## Recommendations
- Enable rerere and merge.conflictstyle zdiff3 before merge
- Use sync worktree via bun run sync-upstream:apply
- Expect conflicts in patched files, especially keybind and provider
- Prepare to port ThemeState.set if upstream theme context changed
- Verify cache_creation_tokens is no longer needed
- Clean graphify-out before merge to reduce noise
