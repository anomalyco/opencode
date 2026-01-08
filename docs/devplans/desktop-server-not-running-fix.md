# Desktop App "Server not running" Fix Plan

## Problem Summary

The desktop app displays "Server not running" error when exiting because of a race condition in `ServerState` initialization.

## Root Cause Analysis

### The Issue
In [`lib.rs:322-328`](packages/desktop/src-tauri/src/lib.rs:322), the exit handler calls `kill_sidecar()`:

```rust
.run(|app, event| {
    if let RunEvent::Exit = event {
        println!("Received Exit");
        kill_sidecar(app.clone());  // Tries to access ServerState
    }
});
```

### The Race Condition

| Sequence | Event | ServerState Status |
|----------|-------|-------------------|
| T0 | App starts, `setup()` called | Not initialized |
| T1 | `app.manage(LogState(...))` called (line 220) | LogState exists |
| T2 | Async spawn block starts | - |
| T3 | User closes app window | - |
| T4 | Exit event fires | ❌ **ServerState not yet initialized** |
| T5 | `kill_sidecar()` tries to access `app.try_state::<ServerState>()` | Returns `None` |
| T6 | "Server not running" printed | - |
| T299 | Async block reaches line 299: `app.manage(ServerState(...))` | Too late! |

**ServerState is only managed at line 299, which is inside an async block that runs AFTER the window is built. If the user closes the app before that line executes, `ServerState` doesn't exist.**

## Additional Issues Found

1. **Line 4**: Unused import `get_sidecar_path` - only used in non-Windows path (lines 123)
2. **Line 96**: Unused function `get_user_shell` - only used in non-Windows path
3. **Line 275**: Unnecessary `mut` on `window_builder`

## Solution

### Option A: Initialize ServerState Early (Recommended)

Move `ServerState` initialization to happen before the async spawn block:

```rust
.setup(move |app| {
    let app = app.handle().clone();

    // Initialize log state
    app.manage(LogState(Arc::new(Mutex::new(VecDeque::new()))));

    // ✅ FIX: Initialize ServerState early (empty, no child)
    app.manage(ServerState(Arc::new(Mutex::new(None))));

    {
        // ... async spawn block continues as before ...
        // But updates ServerState instead of creating it:
        // app.manage(ServerState(...)) becomes:
        // let mut state = server_state.0.lock().unwrap();
        // *state = Some(child);
    }
```

### Option B: Add Null Check in kill_sidecar

Make `kill_sidecar` handle the case where `ServerState` doesn't exist gracefully:

```rust
#[tauri::command]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        println!("Server was never started or already stopped");
        return;
    };
    // ... rest of function
```

## Implementation Plan

### Step 1: Fix ServerState Race Condition
- Move `ServerState` initialization to `setup()` before async spawn
- Update async block to modify existing state instead of creating new state
- Remove line 299: `app.manage(ServerState(...))`

### Step 2: Clean Up Unused Code
- Remove unused import `get_sidecar_path` (line 4)
- Remove unused function `get_user_shell` (lines 96-98)
- Remove `mut` from `window_builder` (line 275)

### Step 3: Improve kill_sidecar Error Message
- Change "Server not running" to more descriptive message
- Optionally: return `Result<(), String>` for better error handling

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `packages/desktop/src-tauri/src/lib.rs` | 4 | Remove unused import |
| `packages/desktop/src-tauri/src/lib.rs` | 96-98 | Remove unused function |
| `packages/desktop/src-tauri/src/lib.rs` | 220 | Add `ServerState` initialization |
| `packages/desktop/src-tauri/src/lib.rs` | 275 | Remove `mut` |
| `packages/desktop/src-tauri/src/lib.rs` | 299 | Remove (state already initialized) |
| `packages/desktop/src-tauri/src/lib.rs` | 30-50 | Update `kill_sidecar` to handle missing state |

## Testing

1. Run `bun dev` in `packages/desktop`
2. Close the app quickly after window appears
3. Verify no "Server not running" error
4. Let app run normally and close - should still work correctly
