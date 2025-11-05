# JSX Component Plugin Example

This example demonstrates how to create OpenCode plugins that export **actual JSX/Solid.js components** instead of just plain text strings.

## Why JSX Components?

Plugins that return text strings (`type: "text"`) are limited to static content. JSX components unlock:

- ✅ **Full Solid.js reactivity** - `createSignal`, `createMemo`, `createEffect`
- ✅ **Event handlers** - `onMouseUp`, `onClick`, keyboard events
- ✅ **Colors and theming** - Direct color control with `fg` attributes
- ✅ **Rich UI components** - Progress bars, icons, complex layouts
- ✅ **Conditional rendering** - `<Show>`, `<Switch>`, `<For>`
- ✅ **State management** - Local component state

## Examples Included

### 1. Click Counter Widget

Interactive counter that increments when clicked, with conditional rendering.

```tsx
<text fg="#00FF00" onMouseUp={() => setCount(count() + 1)}>
  Clicks: {count()} (click to increment)
</text>
```

### 2. Colored Stars Widget

Clickable star list with selection state and dynamic colors.

```tsx
<text fg={star.color} onMouseUp={() => setSelectedStar(star.id)}>
  ⭐
</text>
```

## How It Works

1. **Register UI components** via `ui.register` hook
2. **Return JSX** in `ui.render` hook:
   ```tsx
   output.component = <box>...</box>
   output.type = "component"
   ```
3. **OpenTUI renders** the component with full Solid.js support

## Key Differences from Text Plugins

| Feature      | Text Plugin      | JSX Component Plugin |
| ------------ | ---------------- | -------------------- |
| Return type  | `string`         | JSX Element          |
| Reactivity   | ❌ None          | ✅ Solid.js signals  |
| Mouse events | ❌ No            | ✅ Full support      |
| Colors       | ⚠️ ANSI only     | ✅ Direct control    |
| State        | ❌ External only | ✅ Local state       |

## Installation

Add to your `opencode.json`:

```json
{
  "plugins": ["./examples/plugin-jsx-component"]
}
```

## Usage

The widgets will appear in the sidebar under "Widgets" section when registered.

## Available OpenTUI Components

- `<box>` - Container with flexbox layout
- `<text>` - Text with colors and attributes
- `<Show>` - Conditional rendering
- `<For>` - List rendering
- `<Switch>/<Match>` - Multi-way branching

See OpenTUI documentation for full component API.
