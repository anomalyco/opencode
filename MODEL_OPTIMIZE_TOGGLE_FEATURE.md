# Model Optimization Toggle Feature

## Overview

Added a toggle to control model optimization in OpenCode with status bar display and plugin access.

## Features

### 1. Status Bar Display
The bottom status bar now shows the optimization state next to the model info:
```
anthropic claude-sonnet-4-5    OPTIMIZE: ON
```

- **Green "ON"** when enabled
- **Gray "OFF"** when disabled

### 2. Toggle Command
Access via command palette (`Cmd+O` or configured keybind):
- Command: "Toggle model optimization (ON/OFF)"
- Category: Agent
- Keybind: `optimize_toggle` (can be configured in keybindings)

### 3. Plugin Access
Plugins can now access the optimization state via the `prompt.before` hook:

```typescript
export const MyPlugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // Check if optimization is enabled
      if (input.optimizeEnabled) {
        // Apply optimizations
        if (input.prompt.includes("simple")) {
          output.model = {
            providerID: "anthropic",
            modelID: "claude-3-5-haiku-20241022"
          }
        }
      } else {
        // Skip optimization - use default model
        console.log("Optimization disabled, using default model")
      }
    }
  }
}
```

### 4. Persistent State
The toggle state is saved to `~/.opencode/state/optimize.json` and persists across sessions.

## Implementation Details

### Files Modified

1. **packages/opencode/src/cli/cmd/tui/context/local.tsx**
   - Added `optimize` state management
   - Provides `enabled`, `toggle()`, and `set()` methods
   - Persists state to disk

2. **packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx**
   - Added "OPTIMIZE: ON/OFF" display in status bar
   - Shows next to model info with color coding

3. **packages/opencode/src/cli/cmd/tui/app.tsx**
   - Added "Toggle model optimization" command
   - Accessible via command palette

4. **packages/opencode/src/session/prompt.ts**
   - Added `optimizeEnabled` to `PromptInput` schema
   - Passes state to `prompt.before` hook

5. **packages/plugin/src/index.ts**
   - Added `optimizeEnabled: boolean` to `prompt.before` input type
   - Plugins can now check optimization state

## Usage

### For Users

1. **Toggle optimization:**
   - Press `Cmd+O` (or your command palette key)
   - Type "toggle model"
   - Select "Toggle model optimization"
   - Or configure a dedicated keybinding for `optimize_toggle`

2. **Check current state:**
   - Look at the bottom status bar
   - You'll see "OPTIMIZE: ON" (green) or "OPTIMIZE: OFF" (gray)

### For Plugin Developers

Update your plugin to respect the optimization toggle:

```typescript
export const ModelOptimizerPlugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // Only optimize if user has it enabled
      if (!input.optimizeEnabled) {
        return // Skip optimization
      }

      // Your optimization logic here
      if (isSimpleTask(input.prompt)) {
        output.model = cheapModel
      } else if (isComplexTask(input.prompt)) {
        output.model = powerfulModel
      }
    }
  }
}
```

## Example Plugin

```typescript
export const TestPlugin = async () => {
  console.log("🎯 Test Plugin Loaded!")

  return {
    "prompt.before": async (input: any, output: any) => {
      console.log("\n" + "=".repeat(60))
      console.log("🔥 PROMPT.BEFORE HOOK FIRED!")
      console.log("=".repeat(60))
      console.log("Session:", input.sessionID)
      console.log("Agent:", input.agent)
      console.log("Prompt:", input.prompt)
      console.log("Optimize Enabled:", input.optimizeEnabled ? "✅ ON" : "❌ OFF")
      console.log("=".repeat(60) + "\n")

      // Only apply model optimization if enabled
      if (input.optimizeEnabled) {
        if (input.prompt.toLowerCase().includes("simple")) {
          output.model = {
            providerID: "anthropic",
            modelID: "claude-3-5-haiku-20241022"
          }
          console.log("✅ SWITCHED TO HAIKU (optimization enabled)\n")
        }
      } else {
        console.log("⏭️  Skipping optimization (disabled by user)\n")
      }
    }
  }
}
```

## Testing

1. **Start OpenCode:**
   ```bash
   cd ~/Development/ai/opencode-auto
   bun dev
   ```

2. **Check initial state:**
   - Bottom status bar should show "OPTIMIZE: ON" (default)

3. **Toggle it:**
   - Press `Cmd+O`
   - Type "toggle model"
   - Select the command
   - Status bar should update to "OPTIMIZE: OFF"
   - Toast message confirms the change

4. **Test with plugin:**
   - Send prompt: "This is a simple task"
   - With OPTIMIZE ON: Should switch to Haiku
   - With OPTIMIZE OFF: Should use default model

## Benefits

1. **User Control**: Users can enable/disable model optimization without changing plugins
2. **Cost Savings**: Users can turn off optimization to always use their preferred model
3. **Debugging**: Easy to test with/without optimization
4. **Plugin Respect**: Plugins can check the user's preference instead of forcing optimization

## Next Steps

- Add keybinding configuration documentation
- Consider adding optimization profiles (aggressive/balanced/conservative)
- Add metrics tracking (how much $ saved with optimization ON)
