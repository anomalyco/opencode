# Findings & Decisions
<!--
  WHAT: Knowledge base for ZFlow TODO completion
  WHY: Context windows are limited - this file is external memory
  WHEN: Update after ANY discovery (2-Action Rule)
-->

## Requirements
From TODO.md analysis:
- Fix TypeScript type errors preventing desktop-viz from building
- Integrate TaskView into main application routing
- Test basic functionality (startup, navigation, SSE connection)
- Implement Skill invocation functionality
- High-priority items marked with 🔴 in TODO.md

## Research Findings

### Project Structure (from Explore agent)
- **desktop-viz package**: Contains 5 visualization components + TaskView page
- **app package**: Main React/SolidJS application with routing
- **desktop package**: Tauri desktop app wrapper
- **Package manager**: Bun 1.3.5 with Turbo for monorepo orchestration

### Type Error Root Causes
1. **Context Export Problem**: `packages/app/src/index.ts` doesn't export `useServer`, `useSDK` from context files
2. **Module Resolution**: desktop-viz tries to import `@opencode-ai/app/context/server` directly
3. **SDK v2 Types**: Import `@opencode-ai/sdk/v2/gen/types` not exported at package level
4. **Circular Dependency**: desktop-viz → app/context → sdk/v2 creates dependency cycle

### Desktop-viz Components (need to be moved)
- `TaskTimeline.tsx` - Timeline visualization
- `StepVisualization.tsx` - Step progress display
- `ToolCallMonitor.tsx` - Tool call monitoring
- `SkillsPanel.tsx` - Skills list panel
- `McpDashboard.tsx` - MCP protocol dashboard

### Current Route Status
TaskView route is commented out in `packages/app/src/app.tsx:129-137` due to type errors

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Use Solution C: Move components to app package | TODO.md line 59 recommends this as simplest approach |
| Keep components in src/components/task/ | Maintains separation from other app components |
| Update imports after moving | Required for local references instead of package imports |
| Test with typecheck after moves | Verifies fix worked |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Type errors block development | Implementing Solution C to resolve imports |
| TaskView route disabled | Will enable after fixing type errors |

## Resources
- TODO.md lines 46-72: Type error details and solutions
- TODO.md lines 77-88: TaskView integration steps
- TODO.md lines 110-127: Skill invocation implementation
- packages/desktop-viz/src/: Source files to move
- packages/app/src/: Target location
- packages/app/src/app.tsx:129-137: Route to uncomment

## Visual/Browser Findings
- Explore agent revealed desktop-viz has 5 components + 1 page
- App package structure: src/context/, src/components/, src/pages/
- TypeScript configs show both packages use strict mode

---
*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*
