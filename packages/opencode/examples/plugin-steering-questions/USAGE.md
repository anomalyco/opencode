# Steering Questions Plugin - Usage Guide

## Quick Start

1. **Add to your OpenCode config** (`opencode.jsonc` or `opencode.json`):

   ```json
   {
     "plugins": ["./examples/plugin-steering-questions"]
   }
   ```

2. **Start OpenCode** - The plugin will register automatically

3. **Check the sidebar** - Look for "Steering Q&A Demo" widget in the Tools section

## Demo Widget

The `demo.tsx` file provides a working example with 4 tabs:

### Architecture Tab

- **Framework**: React, Vue, Svelte, Vanilla (single choice)
- **State Management**: Context, Redux, Zustand, Jotai (single choice)

### Styling Tab

- **CSS Approach**: Tailwind, CSS Modules, Styled Components, SCSS (multi-choice)
- **Theme System**: Light/Dark, Multiple Themes, Custom, None (single choice)

### Testing Tab

- **Unit Testing**: Vitest, Jest, None (single choice)
- **E2E Testing**: Playwright, Cypress, None (single choice)

### Deployment Tab

- **Platform**: Vercel, Netlify, AWS, Docker (single choice)
- **CI/CD**: GitHub Actions, GitLab CI, CircleCI, None (multi-choice)

## Interaction Guide

### Selecting Options

**Single Choice (Radio Buttons)**

- Click on any option to select it
- ◉ = Selected
- ○ = Not selected
- Clicking the selected option deselects it

**Multi Choice (Checkboxes)**

- Click options to toggle them on/off
- ☑ = Selected
- ☐ = Not selected
- Can select multiple options

### Navigating Tabs

- Click on tab names to switch between question groups
- Active tab is highlighted in accent color with ● indicator
- Inactive tabs shown with ○ indicator

### Submitting Answers

- The submit button shows count: "Submit Answers (N selected)"
- Click to submit all selected answers across all tabs
- After submission, see a summary of your choices

### Visual Feedback

- **Accent color**: Selected options and active tab
- **Muted gray**: Unselected options and inactive tabs
- **Success green**: Submit button (when answers selected) and confirmation

## Customization

### Creating Your Own Questions

Edit `demo.tsx` to add your own question sets:

```typescript
const questions: Record<TabId, Array<Question>> = {
  "your-tab": [
    {
      id: "your-question",
      label: "Your Question Label",
      type: "single", // or "multi"
      options: ["Option A", "Option B", "Option C"],
    },
  ],
}
```

### Adding More Tabs

```typescript
type TabId = "tab1" | "tab2" | "your-new-tab"

const tabs: Array<{ id: TabId; label: string }> = [{ id: "your-new-tab", label: "Your Tab Name" }]
```

## Integration with Message Stream

The main `index.tsx` file shows how to embed steering questions **inline in the message list** (not in sidebar). This would allow the AI to ask questions mid-conversation.

### Concept

```
User: "Build me a web app"
AI: "Sure! Let me understand your requirements first."
[Steering Question Widget Appears]
User: [Selects options and submits]
AI: "Great! Based on your choices (React + Tailwind + Vitest), I'll..."
```

### Implementation Needed

To fully integrate this into the message stream:

1. **Backend Integration**: Handle answer submission via API
2. **Message Part Type**: Register "steering-question" as a new message part type
3. **Model Prompt**: Train/prompt the model to output steering question configs
4. **Answer Context**: Feed submitted answers back to model as context

## State Management

The plugin uses SolidJS signals for reactive state:

- `activeTab()` - Currently active tab
- `answers()` - Object mapping question IDs to selected values
- `submitted()` - Whether answers have been submitted

## Theming

The plugin uses OpenCode's theme system:

- `theme.accent` - Highlights and active states
- `theme.text` - Primary text
- `theme.textMuted` - Secondary text
- `theme.success` - Confirmation states
- `theme.backgroundPanel` - Widget background

## Keyboard Shortcuts

Currently mouse-driven. Future enhancements could add:

- Tab navigation with arrow keys
- Space/Enter to select options
- Ctrl+Enter to submit

## Data Format

Submitted answers format:

```typescript
{
  "framework": "React",
  "css": ["Tailwind", "CSS Modules"],
  "unit": "Vitest"
}
```

Single choice = string value
Multi choice = array of strings

## Troubleshooting

**Widget not appearing?**

- Check `opencode.jsonc` plugin path is correct
- Restart OpenCode after config changes
- Check console for plugin loading errors

**Theme colors wrong?**

- Plugin uses `context.theme` - ensure theme context is available
- Falls back to default colors if theme unavailable

**Clicks not working?**

- Ensure `onMouseUp` handlers are present
- Check if text selection is interfering
- Try clicking directly on the text, not spacing

## Advanced Usage

### Conditional Questions

Show questions based on previous answers:

```typescript
<Show when={answers()["framework"] === "React"}>
  <Question id="react-version" label="React Version?" ... />
</Show>
```

### Validation

Add custom validation logic:

```typescript
const isValid = () => {
  return answers()["required-field"] !== undefined
}
```

### Progress Tracking

Show completion percentage:

```typescript
const progress = () => {
  const total = allQuestions.length
  const answered = Object.keys(answers()).length
  return Math.round((answered / total) * 100)
}
```

## Next Steps

1. Try the demo widget in the sidebar
2. Modify questions to match your use case
3. Experiment with tab organization
4. Consider message stream integration
5. Add backend handling for submitted answers

## Contributing

To improve this plugin:

- Add text input support with dialog integration
- Implement validation rules
- Add conditional question logic
- Create preset question templates
- Build answer persistence across sessions
