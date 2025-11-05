# Message Widgets System

Plugin system for rendering interactive widgets within assistant message streams.

## Overview

Message widgets allow plugins to register patterns that detect special markup in assistant messages and render interactive UI components inline with the message text.

## Architecture

```
Assistant Message
     ↓
MessageWidgets.detect()  → Find widget patterns
     ↓
MessageWidgets.splitText() → Split into text/widget segments
     ↓
For each widget segment:
  UIRegistry.renderComponent() → Plugin renders widget
     ↓
Rendered message with embedded widgets
```

## Plugin API

### 1. Register Message Widgets

In your plugin's `ui.register` hook:

```typescript
export const MyPlugin = async () => {
  return {
    "ui.register": async (_input, output) => {
      output.messageWidgets = [
        {
          id: "my-widget",
          pattern: /<my-widget[^>]*>([\s\S]*?)<\/my-widget>/g,
          extractConfig: (match) => {
            // Optional: custom config extraction
            return JSON.parse(match[1])
          },
        },
      ]
    },

    "ui.render": async (input, output) => {
      const { componentId, context } = input

      if (componentId === "my-widget") {
        const { config, theme } = context

        // Return component or text
        output.component = MyWidgetComponent
        output.type = "component"
      }
    },
  }
}
```

### 2. Usage in Messages

The model includes the widget tag in its response:

```
Here are some options for you:

<my-widget id="example">
{
  "title": "Configuration",
  "options": ["Option 1", "Option 2"]
}
</my-widget>

Let me know your choice!
```

### 3. Widget Definition

```typescript
interface MessageWidgetDefinition {
  // Unique widget identifier
  id: string

  // Regex pattern to match widget tags (must be global: /g)
  pattern: RegExp

  // Optional: Extract config from regex match
  // Default: JSON.parse(match[1])
  extractConfig?: (match: RegExpMatchArray) => any
}
```

## Detection & Rendering

### Detect Widgets

```typescript
import { MessageWidgets } from "./src/ui/message-widgets"

const text = "Text with <widget>config</widget> embedded"
const detected = await MessageWidgets.detect(text)

// Returns:
// [{
//   widgetId: "widget",
//   match: RegExpMatchArray,
//   config: parsed config,
//   startIndex: 10,
//   endIndex: 35
// }]
```

### Split Text

```typescript
const segments = await MessageWidgets.splitText(text)

// Returns:
// [
//   { type: "text", content: "Text with " },
//   { type: "widget", widgetId: "widget", config: {...} },
//   { type: "text", content: " embedded" }
// ]
```

### Render Widget

```typescript
const result = await MessageWidgets.render("widget-id", config, context)

// Returns:
// {
//   component?: JSX.Element,
//   content?: string,
//   type: "text" | "component" | ...,
//   error?: string
// }
```

## Example: Steering Questions

```typescript
export const SteeringQuestionsPlugin = async () => {
  return {
    "ui.register": async (_input, output) => {
      output.messageWidgets = [
        {
          id: "steering-question",
          pattern: /<steering-question[^>]*>([\s\S]*?)<\/steering-question>/g,
        },
      ]
    },

    "ui.render": async (input, output) => {
      const { componentId, context } = input

      if (componentId === "steering-question") {
        const { config, onSubmit, theme } = context

        const SteeringWidget = () => {
          // Widget implementation with Solid.js
          const [answers, setAnswers] = createSignal({})

          return (
            <box>
              <text>{config.title}</text>
              {/* Interactive UI */}
            </box>
          )
        }

        output.component = SteeringWidget
        output.type = "component"
      }
    },
  }
}
```

Model usage:

```
I'll help you build that feature! First, let me understand your requirements:

<steering-question id="auth-setup">
{
  "title": "Authentication Setup",
  "questions": [
    {
      "id": "method",
      "label": "Auth Method",
      "type": "single-choice",
      "options": ["JWT", "Sessions", "OAuth"]
    }
  ]
}
</steering-question>

Once you answer, I'll start implementing.
```

## Pattern Guidelines

### 1. Use Global Regex

Always use the `g` flag:

```typescript
// ✅ Correct
pattern: /<widget>(.*?)<\/widget>/g

// ❌ Wrong (won't find multiple matches)
pattern: /<widget>(.*?)<\/widget>/
```

### 2. Capture Config

Use capture group `([\s\S]*?)` for content:

```typescript
pattern: /<widget[^>]*>([\s\S]*?)<\/widget>/g
//                     ^^^^^^^^^^^^ Captured as match[1]
```

### 3. JSON Config

Default behavior parses captured content as JSON:

```xml
<widget>
{"key": "value"}
</widget>
```

### 4. Custom Extraction

Override with `extractConfig`:

```typescript
{
  pattern: /<widget data="([^"]+)"/g,
  extractConfig: (match) => ({
    data: match[1]
  })
}
```

## Context Passed to Widgets

When rendering, plugins receive:

```typescript
context: {
  config: any,           // Parsed widget config
  theme: "dark" | "light",
  sessionID?: string,
  width?: number,
  height?: number,
  client: OpencodeClient, // SDK for data access
  onSubmit?: (data: any) => void, // Callback for submissions
  [key: string]: any
}
```

## Best Practices

### 1. Unique Widget IDs

Use descriptive, unique IDs:

```typescript
// ✅ Good
id: "steering-question"
id: "code-diff-viewer"

// ❌ Bad (too generic)
id: "widget"
id: "component"
```

### 2. Handle Parse Errors

Gracefully handle malformed config:

```typescript
try {
  const config = JSON.parse(match[1])
  // ...
} catch (error) {
  output.content = "Invalid widget configuration"
  output.type = "text"
  output.error = error.message
}
```

### 3. Widget Lifecycle

- Widgets are stateful (Solid.js signals)
- State persists until message re-renders
- Use `onSubmit` callbacks for user actions

### 4. Theme Support

Respect theme colors:

```typescript
const { theme } = context

<box
  borderColor={theme?.accent || "#0088ff"}
  backgroundColor={theme?.backgroundPanel || "#1a1a1a"}
>
  <text fg={theme?.text || "#ffffff"}>
    {content}
  </text>
</box>
```

## Testing

### Unit Test Pattern Detection

```typescript
const pattern = /<my-widget>(.*?)<\/my-widget>/g
const text = 'Text <my-widget>{"key":"value"}</my-widget> more'

let match
while ((match = pattern.exec(text)) !== null) {
  console.log("Found:", match.index, match[0])
  const config = JSON.parse(match[1])
  console.log("Config:", config)
}
```

### Integration Test

Create plugin and test with MessageWidgets:

```typescript
const segments = await MessageWidgets.splitText(messageText)
for (const seg of segments) {
  if (seg.type === "widget") {
    const result = await MessageWidgets.render(seg.widgetId, seg.config, { theme: "dark" })
    console.log("Rendered:", result.type)
  }
}
```

## Examples in Repo

- `examples/plugin-steering-questions/` - Complete implementation
- `examples/plugin-steering-questions/demo.tsx` - Sidebar demo version

## API Reference

### MessageWidgets.detect(text)

Detect all widgets in text.

**Returns:** `Array<DetectedWidget>`

```typescript
interface DetectedWidget {
  widgetId: string
  match: RegExpMatchArray
  config: any
  startIndex: number
  endIndex: number
}
```

### MessageWidgets.splitText(text)

Split text into segments.

**Returns:** `Array<TextSegment | WidgetSegment>`

```typescript
type Segment =
  | { type: "text"; content: string }
  | { type: "widget"; widgetId: string; config: any; match: RegExpMatchArray }
```

### MessageWidgets.render(widgetId, config, context)

Render a widget using its plugin.

**Returns:** `RenderResult`

```typescript
interface RenderResult {
  content?: string
  component?: any
  type: "text" | "markdown" | "component" | ...
  error?: string
}
```

## Roadmap

- [ ] Widget event system (refresh, update)
- [ ] Widget-to-widget communication
- [ ] Nested widget support
- [ ] Widget templates/presets
- [ ] Performance optimizations for large messages
