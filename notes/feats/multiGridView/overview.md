# Multi-Grid View (Hyprland-Style Session Tiling)

## Goal
Transform the standard single-thread chat UI in OpenCode into a dynamic, multi-agent tiling workspace inspired by window managers like Hyprland. 

Power users frequently juggle multiple contexts (e.g. looking at a chat with backend schema details while prompting the frontend implementation in another). This feature allows users to seamlessly tile multiple chat sessions on screen simultaneously.

### Intended Behavior:
- **Grid Mode Toggle**: A new toggle in the sidebar enables/disables Grid Mode.
- **Selection**: When Grid Mode is ON, clicking sessions in the sidebar adds them to the grid view instead of replacing the current session. Clicking an active session removes it.
- **Layout**: The grid automatically splits available screen real estate (up to 3x3).
  - 1 Chat: Full screen
  - 2 Chats: Split horizontally (2 columns)
  - 3 Chats: 3 columns
  - 4 Chats: 2x2 grid
  - 5-6 Chats: 3 columns, 2 rows
- **URL State**: The grid layout is perfectly preserved in the URL via `?grid=id1,id2` parameters, allowing for shareable and refreshable workspace layouts.

## What Was Done So Far

### 1. State Management & Routing
- Added `gridMode` to the global `layout.sidebar` Zustand/Solid store.
- Modified `app.tsx`'s `<SessionRoute>` to intercept the `?grid=` URL parameters. If multiple IDs exist, it renders the new `<SessionGrid>` component; otherwise, it falls back cleanly to the native single `<Session>`.
- Automatically clears the grid parameters if the user toggles Grid Mode OFF.

### 2. Multi-Session Context Isolation
- **The Challenge**: OpenCode's deep context providers (`PromptProvider`, `TerminalProvider`, etc.) inherently relied on `useParams().id` to know which chat they belonged to. Rendering multiple `<Session>` components simultaneously caused them to collide and read from the same URL ID.
- **The Fix**: Created a `useSessionParams()` hook and a `<SessionParamsProvider>`. Every tile in the grid wraps its `<Session>` in this provider, tricking the child contexts into thinking *its* specific ID is the only one in the URL.

### 3. Dynamic Tiling Component
- Implemented `SessionGrid` (`packages/app/src/pages/session-grid.tsx`).
- Uses a reactive `createMemo` to compute standard CSS Grid Tailwind classes (`grid-cols-X grid-rows-Y`) based entirely on the array length of active sessions.
- Added self-contained close buttons and focus-ring states (blue border) for the currently "active" tile.
- **Drag-to-Swap**: Each grid tile is draggable via native HTML5 drag-and-drop. Dragging one tile over another swaps their positions in the grid and updates the URL, making layouts persistent and shareable. The dragged tile dims slightly (`opacity-50`) while dragging.

### 4. Sidebar & UI Integration
- Added `<GridToggleItem>` strictly beneath the "New session" buttons in both the expanded Workspace Panel and the hoverable Project Rail.
- Updated `SessionItem`'s `onClick` handler to intelligently manage the `?grid` URL array (pushing new IDs, popping existing ones) when Grid Mode is active.
- Updated `isActive` computations in the sidebar so *all* currently tiled sessions appear highlighted, rather than just the primary one.

### 5. Glitch Resolution
- **Tooltip DOM Error**: Fixed a SolidJS `HierarchyRequestError` that fired when collapsing the sidebar by refactoring how the `<Tooltip>` components swap DOM nodes with their fallbacks.
- **Title Bar Jumble**: Fixed a bug where multiple tiled sessions were all simultaneously trying to use React Portals to render their `<SessionHeader>` action buttons (like "Open in Cursor") into the global top `<Titlebar>`. Now, only the actively focused session (matching `params.id`) mounts to the header.
- **searchParams Runtime Crash & Build Failure**: Resolved a `ReferenceError: searchParams is not defined` crash that occurred when clicking sessions in the sidebar with grid mode active. This required properly initializing `useSearchParams` within the `SessionRow` and `SessionItem` components, as well as fixing a missing `useParams` import in `session-header.tsx` that was silently failing the build and preventing the fix from loading.
- **Sidebar Grid Selection Highlighting**: Fixed an issue where secondary sessions in the grid were not highlighted in the sidebar. Since Solid Router's default `.active` class only applies to exact URL path matches (ignoring `?grid=` query parameters), we implemented a custom `isActive` computation that manually applies the `active` CSS class to all currently tiled sessions in the `SessionRow` component.
- **Grid Focus Navigation Breakage**: Fixed a bug where clicking an unfocused chat tile inside the grid would unexpectedly close the grid entirely and revert to a single chat view. This happened because calling `searchParams.toString()` on Solid's reactive proxy evaluated to `[object Object]`, thereby dropping the required `?grid=` URL parameters during navigation.
- **Sidebar Auto-Close**: Modified the `<GridToggleItem>` in the sidebar so that when a user turns Grid Mode ON, the sidebar automatically collapses to immediately afford the user maximum screen real estate to begin tiling their chats.
- **5-Grid Layout Polish**: Improved the CSS Grid layout algorithm so that when exactly 5 sessions are tiled (a 3-column, 2-row layout), the 5th tile automatically spans across the 3 columns horizontally to fill the empty space rather than leaving a gap in the bottom right.

## Next Steps / Future Polish
- Implementing draggable/resizable splitters between the grid tiles (potentially migrating from native CSS Grid to a dedicated split-pane library like `allotment`).
- Adjusting terminal interactions so specific terminals can map directly to specific tiled sessions.
- Performance optimization if rendering 6+ full CodeMirror/Markdown instances causes UI stuttering.