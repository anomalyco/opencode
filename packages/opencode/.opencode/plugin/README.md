# OpenCode Plugins Directory

This directory contains local plugins that are automatically loaded by OpenCode.

## How It Works

1. **Auto-discovery**: Any `.ts` or `.js` file in this directory is automatically loaded as a plugin
2. **No configuration needed**: Just drop plugin files here and restart OpenCode
3. **File-based loading**: Plugins are loaded using `file://` protocol

## Plugin Format

Each plugin file should export a `Plugin` function:

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx) => {
  return {
    // Plugin hooks go here
    "ui.register": async (input, output) => {
      /* ... */
    },
    "ui.render": async (input, output) => {
      /* ... */
    },
    // etc.
  }
}

export default MyPlugin
```

## Available Hooks

- `ui.register` - Register UI components (widgets, panels, keybinds, etc.)
- `ui.render` - Render component content when requested
- `ui.action` - Handle user actions (button clicks, commands)
- `event` - Listen to OpenCode events
- `config` - Access OpenCode configuration
- `auth` - Provide authentication for AI providers
- `tool` - Register custom tools

## Example Plugin

See `example-ui-plugin.ts` for a complete working example that demonstrates:

- Widget registration
- Panel registration
- Keybind handling
- Dynamic content rendering
- Event listening

## Testing Your Plugin

1. Place your `.ts` file in this directory
2. Restart OpenCode (the TUI will auto-reload on changes)
3. Check logs for plugin loading messages
4. Your UI components should appear in the sidebar

## External Plugins

You can also load plugins from npm packages by adding them to your config:

```json
{
  "plugin": ["my-npm-plugin@1.0.0", "another-plugin@latest"]
}
```

External plugins are installed via Bun and loaded alongside local plugins.
