# Widget Test Feature

## Testing Widget Rendering

A test feature has been added to verify that message widgets render correctly in the TUI.

## How It Works

When any message text contains the string `widget_test`, the TUI will inject a sidebar widget (context panel) directly into the message stream as a test.

## Usage

Send any message containing `widget_test`:
- "please run widget_test"
- "widget_test"
- "testing widget_test rendering"

The response will show:
```
Testing sidebar widget in message stream:

[Context Panel Widget Renders Here]

If you see the context panel above, message widgets work!
```

## What It Tests

✅ **Message widget rendering infrastructure works**
✅ **PluginComponent can render in message stream**  
✅ **Widget detection and segment splitting works**

If the sidebar widget renders but steering questions don't, the issue is specifically with the steering plugin (loading, detection, or pattern matching).

## Implementation

Located in: `src/cli/cmd/tui/routes/session/index.tsx`

```typescript
// In TextPart component
if (text.includes("widget_test")) {
  setSegments([
    { type: "text", content: "Testing sidebar widget in message stream:\n\n" },
    { 
      type: "widget", 
      widgetId: "context-panel",  // Uses working sidebar plugin
      config: {},
      match: [] as any,
      streaming: false
    },
    { type: "text", content: "\n\nIf you see the context panel above, message widgets work!" }
  ])
  return
}
```

## Debugging

This feature helped isolate the steering questions plugin issue:
1. `widget_test` showed sidebar widgets work in messages ✅
2. Proved message widget infrastructure is functional ✅
3. Narrowed problem to steering plugin not loading ❌
4. Found root cause: built .js file had import errors ✅
5. Solution: load source .tsx file instead ✅
