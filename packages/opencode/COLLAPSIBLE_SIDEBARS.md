# Collapsible Sidebars Implementation

## Overview

The TUI now supports collapsible left and right sidebars with centered prompt functionality.

## Features Implemented

### 1. Dual Sidebar Layout

- **Left Sidebar**: Shows session list and quick actions
- **Right Sidebar**: Shows todos, MCP/LSP status, and modified files
- **Main Content**: Messages and prompt area

### 2. Keyboard Shortcuts

- `Ctrl/Cmd + [` : Toggle left sidebar
- `Ctrl/Cmd + ]` : Toggle right sidebar
- `Ctrl/Cmd + B` : Toggle both sidebars

### 3. Responsive Behavior

- **Both sidebars collapsed**: Prompt centers with max-width and auto margins
- **One sidebar expanded**: Prompt takes remaining space
- **Both sidebars expanded**: Prompt takes center space

### 4. Visual Indicators

- Collapse buttons with chevron icons (◀ ▶)
- Hover states for interactive elements
- Smooth transitions between states

### 5. Command Palette Integration

- "Toggle left sidebar" command
- "Toggle right sidebar" command
- "Toggle both sidebars" command
- Legacy "Toggle sidebar" command preserved

## Technical Implementation

### State Management

```typescript
const [leftSidebar, setLeftSidebar] = createSignal<"show" | "hide" | "auto">
const [rightSidebar, setRightSidebar] = createSignal<"show" | "hide" | "auto">
```

### Responsive Calculations

```typescript
const leftSidebarVisible = createMemo(
  () => leftSidebar() === "show" || (leftSidebar() === "auto" && wide()),
)
const bothSidebarsCollapsed = createMemo(() => !leftSidebarVisible() && !rightSidebarVisible())
```

### Layout Structure

```jsx
<box flexDirection="row" gap={2}>
  <Show when={leftSidebarVisible()}>
    <LeftSidebar sessionID={route.sessionID} />
  </Show>

  <box
    flexGrow={1}
    justifyContent={bothSidebarsCollapsed() ? "center" : "flex-start"}
    maxWidth={bothSidebarsCollapsed() ? 120 : undefined}
  >
    {/* Main content */}
  </box>

  <Show when={rightSidebarVisible()}>
    <Sidebar sessionID={route.sessionID} />
  </Show>
</box>
```

## Configuration

New keybinds added to `config.ts`:

- `sidebar_left_toggle`: "ctrl+["
- `sidebar_right_toggle`: "ctrl+]"
- `sidebar_both_toggle`: "ctrl+b"

## Persistence

Sidebar states are persisted to KV storage:

- `leftSidebar`: "show" | "hide" | "auto"
- `rightSidebar`: "show" | "hide" | "auto"

## Usage

1. Use keyboard shortcuts to toggle sidebars
2. Click collapse buttons in sidebar headers
3. Use command palette for additional control
4. Layout automatically adapts to terminal width

## Files Modified

- `src/cli/cmd/tui/routes/session/index.tsx`: Main layout and logic
- `src/cli/cmd/tui/routes/session/sidebar.tsx`: Right sidebar with collapse button
- `src/cli/cmd/tui/routes/session/left-sidebar.tsx`: New left sidebar component
- `src/config/config.ts`: Added new keybind configurations
