# Model Optimization Toggle

## Overview

The Model Optimization Toggle is a user-facing feature that gives you full control over whether plugins can dynamically switch models. This puts you in charge of cost optimization and model selection behavior.

When **ON**: Plugins can analyze your prompts and switch to optimal models
When **OFF**: Plugins use your selected model without modification

## Quick Start

### Toggle the Setting

Press **`Ctrl+O`** to instantly toggle optimization on/off.

Or use the command palette:
1. Press `Ctrl+P` to open commands
2. Type "toggle model"
3. Select "Toggle model optimization"

### Check Current State

Look at the bottom status bar (next to model info):

```
anthropic claude-sonnet-4-5    OPTIMIZE: ON   ← Green = Enabled
anthropic claude-sonnet-4-5    OPTIMIZE: OFF  ← Gray = Disabled
```

## How It Works

### With Optimization ON ✅

```
You: "This is a simple task"
      ↓
Plugin: "Simple task detected, switching to Haiku for cost savings"
      ↓
OpenCode: Uses Claude Haiku ($0.25/M tokens)
      ↓
Result: Task completed, costs 40x less
```

### With Optimization OFF ⏸️

```
You: "This is a simple task"
      ↓
Plugin: "Optimization disabled, respecting user preference"
      ↓
OpenCode: Uses your selected model (e.g., Claude Sonnet 4.5)
      ↓
Result: Task completed with your preferred model
```

## When to Use Each Setting

### Use Optimization ON When:

✅ **You want to save money** - Route simple tasks to cheaper models
✅ **You trust the plugin's logic** - Let it pick the best model for each task
✅ **You have varied workloads** - Mix of simple and complex tasks
✅ **You're experimenting** - Testing different optimization strategies

### Use Optimization OFF When:

✅ **You want consistency** - Always use the same model
✅ **You're debugging** - Eliminate model selection as a variable
✅ **You have specific requirements** - Need a particular model's capabilities
✅ **You're testing prompts** - Want to compare results on the same model

## Default State

**Default: ON**

Optimization is enabled by default because it typically saves money without sacrificing quality for simple tasks.

You can change the default by toggling it - your preference is saved and persists across sessions.

## Status Bar Display

The status bar shows both your model and optimization state:

```
┌─────────────────────────────────────────────────────────┐
│ anthropic claude-sonnet-4-5    OPTIMIZE: ON   Ctrl+P   │
│                                          ↑              │
│                                    Green = ON          │
│                                    Gray = OFF          │
└─────────────────────────────────────────────────────────┘
```

**Color Coding:**
- **Green "ON"**: Optimization enabled - plugins can switch models
- **Gray "OFF"**: Optimization disabled - plugins respect your model choice

## Keybinding

### Default Keybinding

**`Ctrl+O`** - Toggle optimization on/off

### Custom Keybinding

Add to your `~/.config/opencode/config.json`:

```json
{
  "keybinds": {
    "optimize_toggle": "ctrl+shift+o"
  }
}
```

Or any other key combination you prefer:

```json
{
  "keybinds": {
    "optimize_toggle": "f9"           // Function key
    "optimize_toggle": "cmd+o"        // Mac-style
    "optimize_toggle": "alt+o"        // Alt modifier
    "optimize_toggle": "<leader>o"    // Leader key combo
  }
}
```

## Persistent State

Your optimization preference is saved to disk and persists across OpenCode sessions.

**Storage location:** `~/.opencode/state/optimize.json`

**Format:**
```json
{
  "enabled": true
}
```

You can manually edit this file if needed, though it's easier to use the toggle.

## Plugin Integration

If you're developing plugins, always respect the user's optimization preference:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyOptimizerPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      // ✅ ALWAYS check the toggle first
      if (!input.optimizeEnabled) {
        console.log("⏭️  Optimization disabled by user")
        return // Respect user's choice
      }

      // ✅ Only optimize if user wants it
      if (isSimpleTask(input.prompt)) {
        output.model = {
          providerID: "anthropic",
          modelID: "claude-3-5-haiku-20241022"
        }
        console.log("✅ Switched to Haiku (optimization enabled)")
      }
    }
  }
}
```

**Bad practice** ❌:
```typescript
// Don't do this - ignores user preference
"prompt.before": async (input, output) => {
  // Always optimizes, even when user disabled it
  if (isSimpleTask(input.prompt)) {
    output.model = cheapModel // User has no control!
  }
}
```

**Good practice** ✅:
```typescript
"prompt.before": async (input, output) => {
  if (!input.optimizeEnabled) return // Respect user choice

  if (isSimpleTask(input.prompt)) {
    output.model = cheapModel // Only when user wants optimization
  }
}
```

## Use Cases

### Cost Control

**Scenario:** You're on a tight budget

**Strategy:**
- Keep optimization **ON** during regular work
- Switch to **OFF** when you need the best model for critical tasks
- Monitor costs and toggle as needed

**Example workflow:**
```
Regular coding: OPTIMIZE ON  → Uses Haiku ($0.25/M)
Critical design: OPTIMIZE OFF → Uses Sonnet 4.5 ($3/M)
Final review:    OPTIMIZE OFF → Uses best model
```

### Debugging

**Scenario:** Model switching is causing inconsistent results

**Strategy:**
- Toggle **OFF** to eliminate model selection as a variable
- Run your tests with consistent model
- Once debugged, toggle back **ON**

### A/B Testing

**Scenario:** Testing prompt quality

**Strategy:**
```
Test 1: OPTIMIZE OFF + "Fix this bug"
        → Claude Sonnet 4.5 response

Test 2: OPTIMIZE ON + "Fix this bug"
        → Plugin switches to Haiku
        → Haiku response

Compare results to validate plugin's optimization logic
```

### Team Preferences

**Scenario:** Different team members have different preferences

**Strategy:**
- Each developer controls their own toggle
- Settings are per-user (stored locally)
- Share optimization plugins, but let users control activation

## Toast Notifications

When you toggle the setting, you'll see a brief notification:

```
✅ Model optimization enabled
```

or

```
⚠️  Model optimization disabled
```

**Duration:** 2 seconds
**Location:** Bottom of screen
**Dismissible:** Automatically fades

## Command Palette

The toggle command dynamically shows the current state:

```
Commands:
  Toggle model optimization (ON)   ← Currently enabled
  Toggle model optimization (OFF)  ← Currently disabled
```

This helps you know what will happen when you select it.

## FAQ

### Does toggling affect already-running requests?

No. The toggle only affects **new prompts**. Any prompts already being processed continue with their original model.

### Does it affect all sessions?

Yes. The toggle is global across all OpenCode sessions. It's not per-session or per-project.

### Can I set it via config file?

Yes, but it's easier to use the toggle. If you want to set a default:

```json
{
  "optimization": {
    "enabled": false
  }
}
```

Though the persisted state in `~/.opencode/state/optimize.json` will override this after first toggle.

### What if I don't have any optimization plugins?

The toggle has no effect if you don't have plugins that use `prompt.before`. It's a user preference that plugins should respect, but if no plugins check it, nothing changes.

### Can plugins ignore the toggle?

Technically yes, but they **shouldn't**. Well-behaved plugins always check `input.optimizeEnabled` and respect the user's preference. If a plugin ignores it, that's a bug in the plugin.

### Does it affect the `chat.params` hook?

No. The `chat.params` hook doesn't receive the `optimizeEnabled` flag. It's only available in `prompt.before` since that's where model selection happens.

### How do I know if a plugin respects the toggle?

Good plugins will log their behavior:

```
✅ Switched to Haiku (optimization enabled)
⏭️  Skipping optimization (user disabled)
```

Check the plugin's code or documentation to confirm it checks `input.optimizeEnabled`.

## Troubleshooting

### Toggle doesn't work (Ctrl+O does nothing)

**Possible causes:**
1. Another application is capturing the keybinding
2. OpenCode TUI is not focused
3. Keybinding conflict in config

**Solutions:**
- Make sure OpenCode window has focus
- Try using command palette (`Ctrl+P` → "toggle model")
- Check for keybinding conflicts in config
- Restart OpenCode

### Status bar shows wrong state

**Possible causes:**
1. UI not refreshed
2. State file corrupted

**Solutions:**
- Toggle it twice (off then on) to refresh
- Delete `~/.opencode/state/optimize.json` and restart
- Check console logs for errors

### Plugin still optimizes when toggle is OFF

**Possible causes:**
1. Plugin doesn't respect the toggle
2. Plugin has a bug

**Solutions:**
- Check plugin code for `input.optimizeEnabled` check
- File an issue with the plugin maintainer
- Temporarily disable the plugin
- Use a different plugin

### State doesn't persist across restarts

**Possible causes:**
1. State directory not writable
2. Permissions issue

**Solutions:**
- Check `~/.opencode/state/` exists and is writable
- Check file permissions on `optimize.json`
- Manually create the directory if missing

## Performance Impact

The toggle itself has **zero performance impact**. It's just a boolean flag that:

1. Lives in memory (reactive state)
2. Gets persisted to disk asynchronously on change
3. Gets sent with each prompt request

The only performance consideration is plugin logic, but well-written plugins are fast.

## Examples

### Example 1: Testing with and without optimization

```bash
# Start OpenCode
bun dev

# Test with optimization ON (default)
> "This is a simple task"
# Watch plugin switch to Haiku

# Toggle OFF
Ctrl+O
# Status bar shows "OPTIMIZE: OFF"

# Test same prompt
> "This is a simple task"
# Uses your selected model (no switching)

# Compare results
```

### Example 2: Budget-conscious workflow

```bash
# Morning: Regular work with optimization
OPTIMIZE: ON

# Afternoon: Important client meeting
Ctrl+O  # Toggle OFF
# Use best model for client demo

# Evening: Back to regular work
Ctrl+O  # Toggle ON
# Resume cost optimization
```

### Example 3: Plugin development

```typescript
// Testing your plugin's respect for toggle

// Test 1: Optimization ON
// Expected: Plugin switches models

// Test 2: Optimization OFF
// Expected: Plugin does nothing

export const TestPlugin: Plugin = async () => {
  return {
    "prompt.before": async (input, output) => {
      console.log("Toggle state:", input.optimizeEnabled)

      if (!input.optimizeEnabled) {
        console.log("⏭️  Skipping (user disabled)")
        return
      }

      // Your optimization logic
      console.log("✅ Optimizing")
    }
  }
}
```

## Best Practices

### For Users

✅ **Use optimization ON by default** - Save money on routine tasks
✅ **Toggle OFF for important work** - Use best model when it matters
✅ **Check status bar** - Always know current state
✅ **Use Ctrl+O** - Fastest way to toggle
✅ **Monitor costs** - Evaluate if optimization is helping

### For Plugin Developers

✅ **Always check the flag** - Respect user preference
✅ **Log your decisions** - Help users understand behavior
✅ **Document the dependency** - Tell users optimization can be toggled
✅ **Handle both states gracefully** - Work well in both ON and OFF modes
✅ **Test both states** - Verify behavior with toggle ON and OFF

## Related Features

- **[`prompt.before` Hook](./PROMPT_BEFORE_HOOK.md)** - The hook that receives the toggle state
- **Model Selection** - Choose your preferred model
- **Agent Selection** - Choose your preferred agent
- **Command Palette** - Access all commands

## Technical Details

### State Management

```typescript
// State stored in local context (TUI)
const optimize = {
  enabled: boolean,      // Current state
  toggle(): void,        // Toggle function
  set(enabled): void     // Direct setter
}
```

### Client-Server Communication

```typescript
// Client sends toggle state with prompt
sdk.client.session.prompt({
  body: {
    optimizeEnabled: local.optimize.enabled, // ← Toggle state
    // ... other fields
  }
})

// Server passes to plugin hook
Plugin.trigger("prompt.before", {
  optimizeEnabled: input.optimizeEnabled ?? true, // ← Receives state
  // ... other fields
})
```

### File Format

```json
{
  "enabled": true
}
```

Simple JSON file with a single boolean field.

## Changelog

### v1.0.0
- ✨ Initial release of optimization toggle
- ✨ Default keybinding: Ctrl+O
- ✨ Status bar display
- ✨ Persistent state
- ✨ Plugin integration via `prompt.before` hook

## See Also

- [`prompt.before` Hook Documentation](./PROMPT_BEFORE_HOOK.md)
- [Plugin Development Guide](./PLUGIN_DEVELOPMENT.md)
- [Keybinding Configuration](./KEYBINDINGS.md)
- [Status Bar Reference](./STATUS_BAR.md)

## Feedback

Have suggestions for improving the optimization toggle? Open an issue on GitHub!

Want to share how you're using it? Start a discussion!
