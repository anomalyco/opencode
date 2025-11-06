# Core Message Widget Renderers

This directory contains built-in message widgets that render directly in the message stream without requiring the plugin system.

## Architecture

Core message widgets are:
- **Built-in**: Part of the core OpenCode codebase, not plugins
- **Always available**: No need to install or enable
- **Integrated**: Automatically detected and rendered in message streams
- **System-prompted**: Instructions automatically added to agent system prompts

## Available Widgets

### Steering Questions (`steering-question`)

Interactive question widget that allows the AI to gather requirements from users before implementing features.

**Usage in AI responses:**

```
<steering-question id="unique-id">
{
  "title": "Configuration Choices",
  "description": "Help me understand your preferences:",
  "questions": [
    {
      "id": "framework",
      "label": "Frontend Framework",
      "type": "single-choice",
      "options": ["React", "Vue", "Svelte"],
      "required": true
    },
    {
      "id": "features",
      "label": "Features",
      "type": "multi-choice",
      "options": ["Dark Mode", "i18n", "Analytics"]
    }
  ]
}
</steering-question>
```

**Features:**
- Single choice (radio buttons)
- Multi choice (checkboxes)
- Text input fields
- Required field validation
- Submit callback to send answers back to session

## How It Works

### 1. Widget Detection

The `MessageWidgets.detect()` function scans assistant messages for widget patterns:

```typescript
import { getCoreMessageWidgets } from './renderers'

const coreWidgets = getCoreMessageWidgets()
const pluginWidgets = await UIRegistry.getMessageWidgets()
const widgets = [...coreWidgets, ...pluginWidgets]
```

### 2. Widget Rendering

The `PluginComponent` checks for core widgets first before falling back to plugins:

```typescript
const coreWidget = getCoreWidget(props.componentId)
if (coreWidget) {
  return coreWidget.render(props.context)
}
// Fall back to plugin system...
```

### 3. System Prompt Integration

System prompts from core widgets are automatically included:

```typescript
export async function getMessageWidgetSystemPrompts(): Promise<string[]> {
  const prompts: string[] = []
  prompts.push(...getCoreWidgetSystemPrompts()) // Core widgets
  // ... plugin widgets
  return prompts
}
```

## Adding New Core Widgets

To add a new core message widget:

### 1. Create the Widget Component

Create a new file `src/ui/renderers/my-widget.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */

export const MY_WIDGET_PATTERN = /<my-widget[^>]*>([\s\S]*?)<\/my-widget>/g

export const MY_WIDGET_SYSTEM_PROMPT = `
# My Widget

Instructions for the AI on how to use this widget...
`

export function MyWidget(props: { config: any; theme: any; onAction?: (data: any) => void }) {
  return (
    <box>
      {/* Your widget UI */}
    </box>
  )
}
```

### 2. Register in Index

Add to `src/ui/renderers/index.ts`:

```typescript
import { MyWidget, MY_WIDGET_PATTERN, MY_WIDGET_SYSTEM_PROMPT } from './my-widget'

export const CORE_MESSAGE_WIDGETS: CoreMessageWidget[] = [
  // ... existing widgets
  {
    id: "my-widget",
    pattern: MY_WIDGET_PATTERN,
    systemPrompt: MY_WIDGET_SYSTEM_PROMPT,
    render: MyWidget,
  },
]
```

### 3. Export Types

```typescript
export { MyWidget, type MyWidgetProps }
```

That's it! The widget will automatically:
- Be detected in message streams
- Have its system prompt included for the AI
- Render when the AI uses it

## Testing

Test a widget by including its pattern in an AI response:

```typescript
// In session/index.tsx TextPart component, segments will contain:
{
  type: "widget",
  widgetId: "my-widget",
  config: { /* parsed JSON */ },
  match: [...],
  streaming: false
}
```

The `PluginComponent` will then render it using the registered `render` function.
