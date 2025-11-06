# Steering Questions - Core Integration Complete

## Summary

Successfully integrated the steering questions widget as a **core feature** of OpenCode, removing the dependency on the plugin system. The widget now renders inline in message streams automatically.

## What Was Done

### 1. Created Core Widget Renderer System

**New Files:**
- `src/ui/renderers/steering-questions.tsx` - Core steering questions component
- `src/ui/renderers/index.ts` - Core widget registry
- `src/ui/renderers/README.md` - Documentation for core widgets

**Core Widget Architecture:**
```typescript
export interface CoreMessageWidget extends MessageWidgetDefinition {
  id: string
  pattern: RegExp
  systemPrompt?: string
  render: (props: any) => any // Solid component function
}
```

### 2. Integrated with Message Widgets System

**Modified: `src/ui/message-widgets.ts`**
- Import core widgets alongside plugin widgets
- Detect core widget patterns in message text
- Render core widgets directly without plugin system

```typescript
// Detection now includes core widgets
const coreWidgets = getCoreMessageWidgets()
const pluginWidgets = await UIRegistry.getMessageWidgets()
const widgets = [...coreWidgets, ...pluginWidgets]
```

### 3. Updated UI Registry

**Modified: `src/ui/registry.ts`**
- Include core widget system prompts automatically
- Core prompts are added before plugin prompts

```typescript
export async function getMessageWidgetSystemPrompts(): Promise<string[]> {
  const prompts: string[] = []
  prompts.push(...getCoreWidgetSystemPrompts()) // ← Core widgets first
  // ... then plugin widgets
  return prompts
}
```

### 4. Enhanced Plugin Component

**Modified: `src/cli/cmd/tui/component/plugin-component.tsx`**
- Check for core widgets before plugin system
- Render core widgets directly with context props
- Fall back to plugin rendering if not a core widget

```typescript
// Core widgets take priority
const coreWidget = getCoreWidget(props.componentId)
if (coreWidget) {
  const WrappedComponent = () => coreWidget.render(props.context)
  setComponentFn(() => WrappedComponent)
  return
}
// Otherwise use plugin system...
```

## How It Works

### AI Usage

The AI can now use steering questions directly in responses:

```
Before implementing this feature, I need to understand your preferences:

<steering-question id="arch-choices">
{
  "title": "Architecture Decisions",
  "description": "Help me set up the project correctly:",
  "questions": [
    {
      "id": "framework",
      "label": "Frontend Framework",
      "type": "single-choice",
      "options": ["React", "Vue", "Svelte", "Vanilla JS"],
      "required": true
    },
    {
      "id": "styling",
      "label": "Styling Solution",
      "type": "multi-choice",
      "options": ["Tailwind CSS", "CSS Modules", "Styled Components"]
    },
    {
      "id": "notes",
      "label": "Additional Requirements",
      "type": "text",
      "placeholder": "Any specific needs or constraints?"
    }
  ],
  "submitLabel": "Continue with Setup"
}
</steering-question>

Once you submit your choices, I'll configure everything accordingly.
```

### User Experience

1. **Widget appears inline** in the message stream
2. **Interactive UI** with radio buttons, checkboxes, and text fields
3. **Required field validation** - submit button disabled until complete
4. **Visual feedback** - hover states, selection states
5. **Answer submission** - sends responses back as a user message
6. **Submitted state** - shows summary of selected answers

### System Prompt

The AI automatically receives instructions on:
- How to use steering questions
- Question types (single-choice, multi-choice, text)
- When to use steering questions
- Best practices for question design
- Example usage patterns

## Benefits

### ✅ No Plugin Required
- Works out of the box
- No installation needed
- Always available

### ✅ Better Performance
- No plugin loading overhead
- Direct rendering
- Faster detection

### ✅ Maintainability
- Part of core codebase
- Easier to update
- Better type safety

### ✅ Extensible
- Easy to add more core widgets
- Plugin system still available for custom widgets
- Clear separation of concerns

## Testing

To test the integration:

1. **Start a session:**
   ```bash
   bun dev
   ```

2. **Ask the AI to use steering questions:**
   ```
   Can you show me a steering question widget asking about my framework preferences?
   ```

3. **The AI should respond with:**
   ```
   <steering-question id="test">
   {
     "title": "Framework Choice",
     "questions": [
       {
         "id": "framework",
         "label": "Which framework?",
         "type": "single-choice",
         "options": ["React", "Vue", "Svelte"],
         "required": true
       }
     ]
   }
   </steering-question>
   ```

4. **Verify the widget renders** with interactive buttons
5. **Select an option and submit**
6. **Verify answer is sent** back as a user message

## Future Enhancements

### Text Input Support
Currently text inputs are placeholders. To fully support them:
- Integrate with prompt system
- Add dialog for text entry
- Update answer state on dialog close

### Widget Variants
Additional core widgets could include:
- **Confirmation dialogs** - Yes/No choices
- **Progress indicators** - Task completion status
- **Code selectors** - File/function pickers
- **Date/time pickers** - Scheduling widgets
- **Range sliders** - Numeric value selection

### Streaming Support
The detection system supports incomplete widgets during streaming:
```typescript
MessageWidgets.splitText(text, { allowIncomplete: isStreaming })
```

This allows widgets to render progressively as they're being generated.

## Architecture Notes

### Separation of Concerns

```
Core Widgets (built-in)
├── Always available
├── Part of OpenCode core
├── Optimized performance
└── Standard UX patterns

Plugin Widgets (optional)
├── User-installable
├── Custom functionality
├── Plugin-specific features
└── Extended capabilities
```

### Rendering Pipeline

```
Message Text
  ↓
MessageWidgets.detect() → Finds core + plugin patterns
  ↓
MessageWidgets.splitText() → Segments text + widgets
  ↓
PluginComponent → Renders core widgets OR plugin widgets
  ↓
User sees interactive widget in message stream
```

### System Integration

```
Session Start
  ↓
UIRegistry.getMessageWidgetSystemPrompts()
  ↓
  1. getCoreWidgetSystemPrompts() ← Core prompts
  2. Plugin widget prompts ← Plugin prompts
  ↓
Combined prompts sent to AI
  ↓
AI can use any available widget
```

## Files Changed

- ✅ Created: `src/ui/renderers/steering-questions.tsx`
- ✅ Created: `src/ui/renderers/index.ts`
- ✅ Created: `src/ui/renderers/README.md`
- ✅ Modified: `src/ui/message-widgets.ts`
- ✅ Modified: `src/ui/registry.ts`
- ✅ Modified: `src/cli/cmd/tui/component/plugin-component.tsx`

## Migration Notes

The previous plugin-based implementation (`examples/plugin-steering-questions/`) can now be removed or kept as a reference. The core implementation provides the same functionality with better integration.

## Conclusion

The steering questions feature is now a **first-class citizen** of OpenCode, available by default to all users without any setup. The architecture is extensible, allowing for additional core widgets to be added easily while maintaining support for custom plugin-based widgets.
