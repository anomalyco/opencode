# Quick Start Guide

Get the steering questions plugin running in 2 minutes.

## 1. Install (30 seconds)

Add to your `opencode.jsonc`:

```json
{
  "plugins": ["./examples/plugin-steering-questions/demo.tsx"]
}
```

## 2. Start OpenCode (30 seconds)

```bash
bun dev
# or
opencode
```

## 3. See the Widget (1 minute)

1. Open any chat session
2. Look at the right sidebar
3. Find **"Steering Q&A Demo"** in the Tools section
4. You'll see 4 tabs: Architecture, Styling, Testing, Deployment

## 4. Try It Out

**Click around:**

- Switch between tabs (Architecture → Styling → Testing → Deployment)
- Select options (single choice uses ◉/○, multi-choice uses ☑/☐)
- Watch the submit button update: "Submit Answers (N selected)"
- Click submit to see the confirmation

**Example Flow:**

1. Click "Architecture" tab → Select "React" and "Zustand"
2. Click "Styling" tab → Select "Tailwind" and "CSS Modules"
3. Click "Testing" tab → Select "Vitest"
4. Click "Deployment" tab → Select "Vercel" and "GitHub Actions"
5. Click "▶ Submit Answers (6 selected)"
6. See confirmation: "✓ Configuration Submitted"

## What You Built

A custom plugin UI component that:

- ✅ Renders in the sidebar (like other widgets)
- ✅ Has 4 tabbed sections with 2 questions each
- ✅ Supports single-choice (radio) and multi-choice (checkbox) options
- ✅ Tracks state with SolidJS signals
- ✅ Shows visual feedback on hover/selection
- ✅ Validates and submits answers
- ✅ Uses OpenCode's theme system

## Next Steps

### Customize Questions

Edit `demo.tsx` lines 52-106 to change questions:

```typescript
const questions: Record<TabId, Array<Question>> = {
  "your-tab": [
    {
      id: "your-question",
      label: "Your Label",
      type: "single", // or "multi"
      options: ["Option A", "Option B"],
    },
  ],
}
```

### Add More Tabs

```typescript
type TabId = "arch" | "style" | "your-new-tab"

const tabs: Array<{ id: TabId; label: string }> = [{ id: "your-new-tab", label: "Your Tab" }]
```

### Handle Submissions

Edit the `handleSubmit` function (line 124):

```typescript
const handleSubmit = () => {
  setSubmitted(true)

  // Your custom logic here:
  const answers = answers()
  console.log("Answers:", answers)

  // Could send to backend:
  // await fetch("/api/steering-answers", {
  //   method: "POST",
  //   body: JSON.stringify(answers)
  // })
}
```

## File Guide

- **`demo.tsx`** - Working sidebar widget demo (start here!)
- **`index.tsx`** - Full implementation with types and message stream support
- **`README.md`** - Complete plugin documentation
- **`USAGE.md`** - Detailed usage instructions
- **`INTEGRATION_EXAMPLE.md`** - How the model would use this
- **`VISUAL_EXAMPLE.md`** - ASCII art showing widget appearance
- **`package.json`** - Package configuration

## Common Issues

**Widget not showing?**

- Check plugin path in `opencode.jsonc` is correct
- Restart OpenCode after config changes
- Look for errors in console

**Clicks not working?**

- Make sure you're clicking the text, not just hovering
- Check if text selection is interfering

**Colors look wrong?**

- Plugin uses `context.theme` - should work with any OpenCode theme
- Try switching themes with Ctrl+P → "Change theme"

## Architecture Overview

```
demo.tsx (Plugin Entry)
  ↓
ui.register → Registers widget in sidebar
  ↓
ui.render → Returns SolidJS component
  ↓
SteeringDemo Component
  ├── State (signals for tabs, answers, submission)
  ├── Tab Navigation (click to switch)
  ├── Questions (rendered from config)
  ├── Options (click to select)
  └── Submit Button (validates & submits)
```

## Key Concepts

### SolidJS Signals

```typescript
const [value, setValue] = createSignal(initial)
value()        // read
setValue(new)  // write
```

### OpenCode Theme

```typescript
theme.accent // highlight color
theme.text // primary text
theme.textMuted // secondary text
theme.success // confirmation
```

### Mouse Events

```typescript
<text onMouseUp={() => handleClick()}>Click me</text>
```

## Learning Path

1. ✅ **Run the demo** (you're here!)
2. 📝 Read `USAGE.md` for detailed interactions
3. 🎨 Check `VISUAL_EXAMPLE.md` for appearance details
4. 🔧 Modify `demo.tsx` to customize questions
5. 🚀 Read `INTEGRATION_EXAMPLE.md` for message stream integration
6. 📚 Review `index.tsx` for full implementation with types

## Help & Resources

- **Plugin Docs**: `/examples/plugin-jsx-component/README.md`
- **Plugin UI API**: `/src/plugin-ui/canvas.tsx`
- **Other Examples**: `/examples/plugin-sidebar-*`
- **OpenCode Docs**: https://opencode.ai/docs

## Success Criteria

You've successfully set up the plugin when:

- [x] Widget appears in right sidebar
- [x] Tabs are clickable and switch content
- [x] Options can be selected/deselected
- [x] Submit button updates with count
- [x] Confirmation appears after submission

**Time to success: ~2 minutes** ⏱️

Now you have a working interactive Q&A widget that the AI model could use to gather requirements before implementation!
