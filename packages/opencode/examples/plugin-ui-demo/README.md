# Example UI Plugin

This is a demonstration plugin showcasing OpenCode's UI extension system.

## Features

This plugin demonstrates:

- **Widget Registration**: A counter widget that appears in the TUI sidebar
- **Panel Registration**: An info panel showing plugin details
- **Keybind Registration**: `Ctrl+Shift+I` to increment the counter
- **Status Item Registration**: Status bar item showing counter value
- **Command Registration**: Commands that can be executed
- **Dynamic Rendering**: Content that updates based on state
- **Event Handling**: Listening to OpenCode events

## Installation

1. Add to your OpenCode project's plugins:

```json
{
  "plugins": ["@opencode/example-ui-plugin"]
}
```

2. Install the plugin:

```bash
npm install @opencode/example-ui-plugin
```

## Usage

Once loaded, the plugin will:

1. **Show a widget** in the sidebar labeled "Counter Widget"
   - Displays current counter value
   - Shows current session ID and theme

2. **Show a panel** labeled "Example Info"
   - Displays plugin information
   - Shows counter value and last session

3. **Register keybind** `Ctrl+Shift+I`
   - Increments the counter when pressed

4. **Show status item** in the status bar
   - Displays: 🔌 Counter: X

## Code Overview

### Hook: `ui.register`

Registers UI components when the plugin loads:

```typescript
"ui.register": async (input, output) => {
  output.widgets = [{ id: "example-counter-widget", label: "Counter Widget", ... }]
  output.panels = [{ id: "example-info-panel", label: "Example Info", ... }]
  output.keybinds = [{ id: "example-increment", keys: "ctrl+shift+i", ... }]
  // ...
}
```

### Hook: `ui.render`

Renders component content when requested:

```typescript
"ui.render": async (input, output) => {
  switch (input.componentId) {
    case "example-counter-widget":
      output.content = `Counter: ${counter}\nPress Ctrl+Shift+I to increment`
      output.type = "text"
      break
    // ...
  }
}
```

### Hook: `ui.action`

Handles user actions (button clicks, command execution):

```typescript
"ui.action": async (input, output) => {
  switch (input.action) {
    case "increment":
      counter++
      output.result = { counter }
      break
    // ...
  }
}
```

### Hook: `event`

Listens to OpenCode events:

```typescript
event: async (input) => {
  if (input.event.type === "session.created") {
    console.log("[ExampleUIPlugin] New session created")
  }
}
```

## Building Your Own Plugin

Use this example as a template for creating your own UI plugins:

1. **Copy this directory** as a starting point
2. **Modify the component IDs** to be unique to your plugin
3. **Update the labels** and content rendering
4. **Add your own state** and logic
5. **Register your keybinds** and commands
6. **Handle actions** for user interactions

## API Reference

See the OpenCode plugin documentation for full API details:

- `WidgetDefinition` - Sidebar widgets
- `PanelDefinition` - Full panels
- `KeybindDefinition` - Keyboard shortcuts
- `StatusItemDefinition` - Status bar items
- `CommandDefinition` - Executable commands

## License

MIT
