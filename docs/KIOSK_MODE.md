# OpenCode Kiosk Mode

## Overview

Kiosk mode provides a simplified web UI experience by hiding navigation elements and optionally auto-navigating to a new session. This is useful for:

- Embedded deployments
- Simplified onboarding experiences
- Kiosk terminals
- Single-project focused workflows

## URL Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `kiosk=true` | Yes | Enables kiosk mode - hides sidebar and header |
| `dir=/path/to/project` | No | Auto-opens project and navigates to new session |
| `url=http://host:port` | No | Backend server URL (for remote/dev setups) |

## Usage Examples

### Basic Kiosk Mode
Hides navigation, user selects project manually:
```
http://localhost:4096/?kiosk=true
```

### Kiosk Mode with Auto-Project
Hides navigation and auto-opens specific project:
```
http://localhost:4096/?kiosk=true&dir=/home/user/my-project
```

### Development/Remote Setup
Connect to remote backend with kiosk mode:
```
http://localhost:3000/?url=http://192.168.1.100:4096&kiosk=true&dir=/path/to/project
```

## What Gets Hidden

In kiosk mode, the following UI elements are hidden:

1. **Left Sidebar** (desktop and mobile)
   - Project list
   - Session navigation
   - Open project button
   - Provider connection

2. **Top Header Bar**
   - Project selector dropdown
   - Session selector dropdown
   - Server status indicator
   - LSP/MCP indicators
   - Share button
   - Review/Terminal toggles

## What Remains Visible

- Main session workspace (chat interface)
- Terminal panel (if opened via keyboard shortcut)
- Review panel (if opened via keyboard shortcut)
- Toast notifications
- Dialog modals (permissions, file selection, etc.)

## Implementation Details

### Files Modified

| File | Changes |
|------|---------|
| `packages/app/src/context/layout.tsx` | Added `kiosk.enabled()` and `kiosk.dir()` state |
| `packages/app/src/pages/layout.tsx` | Conditional sidebar rendering |
| `packages/app/src/components/session/session-header.tsx` | Conditional header rendering |
| `packages/app/src/pages/home.tsx` | Auto-redirect logic for `dir` parameter |

### How It Works

1. URL parameters are read once at module load time
2. `layout.kiosk.enabled()` returns true if `?kiosk=true` is present
3. `layout.kiosk.dir()` returns the directory path if `?dir=` is present
4. Sidebar and header check `kiosk.enabled()` and hide themselves
5. Home page checks for kiosk mode + dir and auto-navigates to session

## Keyboard Shortcuts

Even in kiosk mode, keyboard shortcuts remain functional:

- `Ctrl+P` / `Cmd+P` - Open command palette
- Terminal and review panel shortcuts still work

## Limitations

- Parameters are read at page load; changing URL params requires page refresh
- No way to exit kiosk mode without removing URL parameter
- Directory path must be accessible by the OpenCode server

## Future Enhancements

Potential improvements for consideration:

- [ ] Session ID parameter to open specific session
- [ ] Theme parameter for kiosk-specific theming
- [ ] Read-only mode parameter
- [ ] Auto-hide prompt input option
- [ ] Configurable visible elements
