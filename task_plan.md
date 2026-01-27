# Task Plan: Complete ZFlow TODO.md Tasks
<!--
  WHAT: Roadmap for completing high-priority ZFlow development tasks
  WHY: TODO.md has clear prioritization - we need to fix type errors and integrate features
  WHEN: Created 2025-01-27, update after each phase
-->

## Goal
Fix TypeScript type errors in desktop-viz package and integrate TaskView into main app to enable task visualization features in ZFlow.

## Current Phase
Phase 4 - Complete (基本测试完成)

## Phases

### Phase 1: Type Error Analysis & Strategy
- [x] Analyze current TypeScript errors in desktop-viz components
- [x] Review desktop-viz to app package dependency structure
- [x] Decide between Solution A (fix exports), B (type declarations), or C (move components)
- [x] Document decision rationale in findings.md
- **Status:** complete

### Phase 2: Fix TypeScript Type Errors
- [x] Implement chosen solution (Solution C: move components)
- [x] Move desktop-viz components to packages/app/src/components/task/
- [x] Move TaskView to packages/app/src/pages/task/
- [x] Update all import paths in moved files
- [x] Verify imports work with new paths
- **Status:** complete

### Phase 3: Integrate TaskView Route
- [x] Uncomment TaskView route in packages/app/src/app.tsx:129-137
- [ ] Add navigation button in Session page to open TaskView (optional, deferred)
- [x] Verify route is accessible
- **Status:** complete

### Phase 4: Test Basic Functionality
- [x] Start dev server: `bun run dev`
- [x] Fix import path errors (discovered during testing)
- [x] Verify server starts without errors
- [x] Document test results in progress.md and TEST_RESULTS.md
- [ ] Verify ZFlow branding displays correctly (requires full app)
- [ ] Test navigation to TaskView (requires backend)
- [ ] Verify SSE event connection (requires backend)
- **Status:** complete (frontend testing done, backend testing requires OpenCode server)

### Phase 5: Integrate Skills & MCP Management UI
- [x] Add Developer Tools button to Session header
- [x] Implement Dialog using useDialog() hook
- [x] Integrate SkillsPanel and McpDashboard components
- [x] Fix Dialog context error by using proper dialog.show() pattern
- [x] Verify HMR updates work correctly
- [ ] Test Skills panel with backend connection
- [ ] Test MCP dashboard with backend connection
- **Status:** complete (UI integration done, backend testing requires OpenCode server)

### Phase 6: Implement Skill Invocation
- [ ] Research OpenCode Skill API (packages/opencode/src/skill/)
- [ ] Add Skill invocation endpoint to Session page
- [ ] Update SkillsPanel component to invoke skills
- [ ] Test skill invocation flow
- **Status:** pending

## Key Questions
1. ~~Should we fix module exports (Solution A) or move components (Solution C)?~~ ✓ **Answer: Solution C**
2. ~~Are there runtime dependencies on desktop-viz package structure?~~ ✓ **Answer: No**
3. What is the Skill API endpoint format for invocation?
4. Does SSE event stream work with current implementation?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use Solution C: Move components to app package | TODO.md line 59 recommends this as simplest approach |
| Keep components in src/components/task/ | Maintains separation from other app components |
| Update imports after moving | Required for local references instead of package imports |
| Defer navigation button addition | Route accessible via URL, button is optional enhancement |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Type errors: Cannot resolve @opencode-ai/app/context/server | 1 | ✅ Implemented Solution C - moved components to app package |
| Import @opencode-ai/sdk/v2/gen/types not found | 1 | ✅ Changed to @opencode-ai/sdk/v2/client (exports types) |
| Relative import paths incorrect after move | 1 | ✅ Updated all relative imports to match new structure |

## Notes
- TODO.md lines 46-72 detail the specific type errors
- TODO.md recommends Solution C (line 59)
- Current branch: feature/zflow
- Working directory: F:\pythonproject\opencode
- Testing requires Rust toolchain for native windows
- Update phase status as you progress: pending → in_progress → complete
- Re-read this plan before major decisions (attention manipulation)
- Log ALL errors - they help avoid repetition
