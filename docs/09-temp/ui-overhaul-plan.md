# UI/UX Overhaul Plan — OpenCode Desktop

**Date:** 2026-02-24
**Status:** TODO — needs brainstorming session with ui-ux-pro-max + frontend-pe skills

## User Requirements
- UI looks "very bad" — needs visual polish and tactile feel
- More themes and theme customization
- Better UI rendering quality
- Font size ✅ (fixed in PR #14821)
- Zoom in/out ✅ (already works via Cmd+/-/0)
- Wide mode ✅ (added in PR #14835)
- More UI settings options needed

## Skills to Use
- `ui-ux-pro-max` — Design system, color palettes, typography, UX guidelines
- `frontend-pe` — Avant-garde UI design, micro-interactions, visual polish
- `brainstorming` — Plan before implementing

## Areas to Investigate
1. **Theme system** — opencode already has theming (`packages/ui/src/context/theme/`). How to add more?
2. **Tactile UI** — Micro-interactions, hover states, transitions, shadows
3. **Typography** — Font rendering, line-height, letter-spacing refinements
4. **Spacing** — Consistent padding/margin system
5. **Colors** — More vibrant palettes, better contrast
6. **Animations** — Smooth transitions between states
7. **Settings page** — More appearance options (line-height, letter-spacing, sidebar width, etc.)

## Tonight's Completed Fixes (6 PRs)
- #14820: Streaming content duplication
- #14821: Font size settings (CSS + terminal + UI)
- #14826: ContextOverflowError recovery
- #14827: Prune before compaction
- #14831: Context usage card + compact button
- #14835: Wide mode setting (full-width chat)
