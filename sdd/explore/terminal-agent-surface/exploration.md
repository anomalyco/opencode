## Exploration: Surfacing Agent-Created PTY Sessions in the Terminal UI

### Current State

#### 1. Terminal Context (`packages/app/src/context/terminal.tsx`)
- Uses a **SolidJS Store** (`createStore`) per workspace to manage PTY sessions.
- **Key data**: `active?: string` (currently focused PTY ID) + `all: LocalPTY[]` (list of sessions).
- **Session lifecycle**:
  - `new()` → calls `sdk.client.pty.create()` and adds to store.
  - `open(id)` → sets `active` to that session.
  - `close(id)` → removes from store and calls `sdk.client.pty.remove()`.
  - `update(pty)` → updates local store + syncs to backend via `client.pty.update()`.
  - `removeExited(id)` → auto-removes on `pty.exited` event.
- **Persistence**: Sessions are persisted to workspace-scoped storage via `Persist.workspace(dir, "terminal")`.
- **Events**: Only listens to `sdk.event.on("pty.exited", ...)` for cleanup. **Does NOT listen to `pty.created`.**

#### 2. Terminal Component (`packages/app/src/components/terminal.tsx`)
- Renders a single PTY session using `ghostty-web` (xterm.js alternative).
- Connects to the backend via WebSocket at `/pty/${id}/connect`.
- **No multi-tab logic** — it renders a single `LocalPTY`. Multi-tabs are handled by the parent (`TerminalPanel`).
- Supports auto-focus via `autoFocus` prop.
- Serializes terminal buffer on cleanup for restoration.

#### 3. Terminal Panel Page (`packages/app/src/pages/session/terminal-panel.tsx`)
- The panel is **opened/closed via the layout store**: `view().terminal.open()`, `view().terminal.close()`, `view().terminal.toggle()`.
- `opened` is derived from `store.terminal.opened` in the global layout store (`context/layout.tsx`).
- When the panel opens and no terminals exist, it **auto-creates** one via `terminal.new()`.
- Supports **tab switching** via `terminal.open(id)`.
- Has a `focus(id)` helper that uses `focusTerminalById(id)` (DOM-based focusing).
- **The panel CAN be programmatically focused**: `view().terminal.open()` opens it; `terminal.open(id)` switches to a specific tab; `focusTerminalById(id)` focuses the textarea.

#### 4. Event System (`packages/app/src/context/sdk.tsx`, `packages/app/src/context/global-sdk.tsx`)
- Events flow: Backend SSE → `globalSDK.event.on(directory, callback)` → `emitter.emit(directory, event)` → `sdk.event.on(eventType, callback)`.
- **Available PTY events** (from backend): `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`.
- **Frontend only listens to `pty.exited`** in the terminal context. `pty.created` is completely unused on the frontend.

#### 5. Agent Terminal Tool (`packages/opencode/src/tool/terminal.ts`)
- The `terminal` tool creates PTY sessions via `pty.create()` with titles like `Agent: ${description}`.
- These sessions are **invisible in the UI** because the frontend doesn't know they exist until it creates them itself.
- The tool maintains its own `InstanceState`-backed session registry, separate from the frontend store.

### Affected Areas
- `packages/app/src/context/terminal.tsx` — needs to listen to `pty.created` events.
- `packages/app/src/pages/session/terminal-panel.tsx` — may need to auto-open/focus on agent-created sessions.
- `packages/opencode/src/tool/terminal.ts` — may need a way to signal "show in UI" intent.

### Approaches

#### 1. **Listen to `pty.created` events in TerminalContext**
   - Add `sdk.event.on("pty.created", ...)` handler in `createWorkspaceTerminalSession()`.
   - When a `pty.created` event fires for a session not in the local store, add it to `store.all`.
   - **Pros**: Zero backend changes; uses existing event bus; sessions automatically appear.
   - **Cons**: All PTY creations (including hidden/internal ones) would appear. Need filtering.
   - **Effort**: Low

#### 2. **Filter by a "visible" flag or title prefix**
   - Backend: add a `visible: boolean` or `source: "agent" | "user"` field to PTY creation.
   - Frontend: only add sessions to the store if they match the filter (e.g., title starts with `Agent:` or a new `visible` flag is set).
   - **Pros**: Precise control over what appears; clean separation.
   - **Cons**: Requires backend schema change; more coordination.
   - **Effort**: Medium

#### 3. **Auto-open/focus the terminal panel on agent-created sessions**
   - When a `pty.created` event is handled and the session is agent-created, call `view().terminal.open()` and `terminal.open(id)`.
   - **Pros**: Immediate visibility for agent actions.
   - **Cons**: Could be disruptive if the user is working on something else; needs rate limiting or user preference.
   - **Effort**: Low (if combined with Approach 1)

#### 4. **Hybrid: Event listening + metadata-driven visibility**
   - Backend `terminal` tool emits `pty.created` with metadata (e.g., `{"source": "agent", "autoFocus": true}`).
   - Frontend TerminalContext listens and decides whether to add to store and/or auto-open based on metadata.
   - **Pros**: Most flexible; supports both passive visibility and active focus.
   - **Cons**: Largest change surface.
   - **Effort**: Medium

### Recommendation

**Go with Approach 1 (listen to `pty.created`) as the foundation, then layer Approach 3 (auto-open/focus) optionally.**

Specifically:
1. In `terminal.tsx` (`createWorkspaceTerminalSession`), add:
   ```ts
   const unsubCreated = sdk.event.on("pty.created", (event: { properties: { info: LocalPTY } }) => {
     const { info } = event.properties
     if (store.all.find((x) => x.id === info.id)) return
     setStore("all", store.all.length, {
       id: info.id,
       title: info.title,
       titleNumber: numberFromTitle(info.title) ?? 0,
     })
     // Optionally: setStore("active", info.id)
   })
   ```
2. Optionally auto-focus: when an agent-created PTY appears, call `view().terminal.open()` and `terminal.open(id)` from the panel component or a new effect.

### Risks
- **Event duplication**: If the frontend also creates the same PTY via `terminal.new()`, ensure we don't duplicate entries in `store.all`.
- **Title collisions**: The agent sets titles like `Agent: foo`. The frontend uses `Terminal N` numbering. The `titleNumber` logic should handle this.
- **Disruption**: Auto-opening the panel could interrupt the user's flow. Consider making it conditional or adding a toast notification instead.
- **Cleanup on exit**: The existing `pty.exited` listener already removes sessions from the store. This should continue to work for agent-created sessions.

### Ready for Proposal
**Yes.** The exploration confirms:
- There is **no existing mechanism** to surface agent-created PTYs in the UI.
- The **integration point** is adding a `sdk.event.on("pty.created", ...)` listener in `TerminalContext`.
- The **store** is a SolidJS `createStore` scoped per workspace.
- The **panel** can be programmatically opened via `view().terminal.open()`.

The orchestrator can now create a PRP for implementing this feature.
