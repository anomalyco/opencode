# Steering Questions Plugin - Complete Package

Interactive Q&A widget system for OpenCode that allows AI models to ask structured questions and gather specific requirements within the chat interface.

## 📦 Package Contents

### Core Files

| File           | Size | Purpose                                           |
| -------------- | ---- | ------------------------------------------------- |
| `demo.tsx`     | 8.8K | **START HERE** - Working demo widget for sidebar  |
| `index.tsx`    | 12K  | Full implementation with types for message stream |
| `package.json` | 261B | Package configuration                             |

### Documentation

| File                     | Size | Purpose                             |
| ------------------------ | ---- | ----------------------------------- |
| `QUICKSTART.md`          | 5.0K | **2-minute setup guide**            |
| `README.md`              | 3.9K | Plugin overview and features        |
| `USAGE.md`               | 5.6K | Detailed usage instructions         |
| `VISUAL_EXAMPLE.md`      | 13K  | ASCII art showing widget appearance |
| `INTEGRATION_EXAMPLE.md` | 9.2K | How models would use this           |

## 🚀 Quick Start (2 minutes)

```bash
# 1. Add to opencode.jsonc
{
  "plugins": ["./examples/plugin-steering-questions/demo.tsx"]
}

# 2. Start OpenCode
bun dev

# 3. Look for "Steering Q&A Demo" in right sidebar
```

## 📖 Reading Order

### For Users

1. **`QUICKSTART.md`** - Get it running (2 min)
2. **`USAGE.md`** - Learn how to use it (10 min)
3. **`VISUAL_EXAMPLE.md`** - See what it looks like (5 min)

### For Developers

1. **`demo.tsx`** - Read the working code (15 min)
2. **`README.md`** - Understand the architecture (10 min)
3. **`index.tsx`** - Study the full implementation (20 min)

### For AI Integration

1. **`INTEGRATION_EXAMPLE.md`** - See model usage patterns (15 min)
2. **`index.tsx`** - Review the full API (20 min)

## 🎯 What This Does

### Problem Solved

Traditional chat for complex requirements:

```
User: "Build X"
AI: "What about Y?"
User: "Use Z"
AI: "And for W?"
User: "Maybe V"
```

(Many back-and-forth messages)

### Solution

AI shows structured questions widget:

```
User: "Build X"
AI: [Shows widget with all questions]
User: [Selects all options at once]
AI: "Got it! Here's X with Y=Z, W=V..."
```

(One interaction)

## ✨ Features

### Question Types

- **Single Choice**: Select one option (radio buttons: ◉/○)
- **Multi Choice**: Select multiple options (checkboxes: ☑/☐)
- **Text Input**: Free-form text (concept - needs dialog integration)

### UI Features

- **Tabbed Organization**: Group related questions (4 tabs with 2 questions each in demo)
- **Visual Feedback**: Colors change on hover/selection
- **State Management**: SolidJS reactive signals track selections
- **Theme Integration**: Uses OpenCode theme colors automatically
- **Validation**: Submit button disabled until requirements met
- **Confirmation**: Clear submission state with summary

## 🏗️ Architecture

```
Plugin Entry (demo.tsx or index.tsx)
  ↓
ui.register() - Registers widget/component
  ↓
ui.render() - Returns SolidJS component function
  ↓
Component Renders
  ├── createSignal() - Reactive state
  ├── Tab Navigation - Switch between question groups
  ├── Questions - Rendered from configuration
  ├── Options - Click handlers for selection
  └── Submit - Validates and submits answers
```

## 🎨 Demo Configuration

### Tabs

1. **Architecture** - Framework, State Management
2. **Styling** - CSS Approach, Theme System
3. **Testing** - Unit Testing, E2E Testing
4. **Deployment** - Platform, CI/CD

### Question Examples

- **Single**: "Framework?" → React | Vue | Svelte | Vanilla
- **Multi**: "CSS Approach?" → Tailwind + CSS Modules + Styled Components + SCSS

## 🔧 Customization

### Add Your Questions

```typescript
const questions = {
  "your-tab": [
    {
      id: "your-id",
      label: "Your Question?",
      type: "single", // or "multi"
      options: ["A", "B", "C"],
    },
  ],
}
```

### Handle Submissions

```typescript
const handleSubmit = () => {
  const answers = answers()
  // Send to backend, update context, etc.
}
```

## 📊 Use Cases

### Development

- Architecture decisions (framework, database, hosting)
- Code style preferences (TypeScript, formatting, testing)
- Feature requirements (auth, payments, real-time)
- Configuration options (environment, CI/CD, monitoring)

### Design

- Component variants (sizes, colors, styles)
- Layout preferences (sidebar, tabs, modals)
- Accessibility features (ARIA, keyboard nav, screen readers)
- Responsive behavior (mobile, tablet, desktop)

### Content

- Tone/style (formal, casual, technical)
- Length/depth (brief, detailed, comprehensive)
- Format (bullet points, prose, code examples)
- Audience (beginner, intermediate, expert)

## 🚦 Integration Status

| Feature         | Demo | Full | Status          |
| --------------- | ---- | ---- | --------------- |
| Sidebar Widget  | ✅   | ✅   | **Working**     |
| Single Choice   | ✅   | ✅   | **Working**     |
| Multi Choice    | ✅   | ✅   | **Working**     |
| Tab Navigation  | ✅   | ✅   | **Working**     |
| Visual Feedback | ✅   | ✅   | **Working**     |
| Submit/Confirm  | ✅   | ✅   | **Working**     |
| Text Input      | ❌   | 📝   | Concept only    |
| Message Stream  | ❌   | 📝   | Concept only    |
| Backend Handler | ❌   | ❌   | Not implemented |
| Model Prompt    | ❌   | ❌   | Not implemented |

✅ = Working | 📝 = Code exists, needs integration | ❌ = Not implemented

## 🛣️ Roadmap

### Phase 1: Core (Complete ✅)

- [x] Single/multi choice questions
- [x] Tab navigation
- [x] Visual feedback
- [x] State management
- [x] Theme integration
- [x] Submit/confirm flow

### Phase 2: Enhancement (Planned)

- [ ] Text input with dialog integration
- [ ] Conditional questions (show B if A = X)
- [ ] Validation rules (regex, min/max)
- [ ] Default values
- [ ] Answer persistence

### Phase 3: Model Integration (Planned)

- [ ] Message stream embedding
- [ ] Tool call for showing questions
- [ ] Answer context injection
- [ ] Backend API handlers
- [ ] Model prompts/training

### Phase 4: Advanced (Future)

- [ ] Nested/dependent questions
- [ ] Dynamic option loading
- [ ] Visual previews
- [ ] Answer history
- [ ] Template library

## 📚 Learning Resources

### Plugin Development

- Plugin architecture: `/examples/plugin-jsx-component/README.md`
- Plugin UI API: `/src/plugin-ui/canvas.tsx`
- Other examples: `/examples/plugin-sidebar-*`

### SolidJS

- Signals: https://www.solidjs.com/tutorial/introduction_signals
- Effects: https://www.solidjs.com/tutorial/introduction_effects
- Control flow: https://www.solidjs.com/tutorial/flow_show

### OpenCode

- Main docs: https://opencode.ai/docs
- Theme system: `/src/cli/cmd/tui/context/theme.tsx`
- Message rendering: `/src/cli/cmd/tui/routes/session/index.tsx`

## 🤝 Contributing

To extend this plugin:

1. **Add question types** - Sliders, date pickers, file uploads
2. **Improve validation** - Regex, dependencies, custom rules
3. **Backend integration** - API endpoints, answer storage
4. **Model prompts** - Training data for question generation
5. **UI enhancements** - Animations, keyboard shortcuts, accessibility

## 📝 Technical Details

### Dependencies

- **SolidJS**: Reactive UI framework
- **OpenTUI**: Terminal UI renderer
- **OpenCode Plugin API**: Plugin registration and rendering

### Browser/Platform

- Terminal UI (TUI) - Runs in terminal
- Works with any OpenCode-compatible terminal
- Tested on macOS/Linux/Windows

### Performance

- Lazy loading: Plugin loads on demand
- Minimal re-renders: SolidJS fine-grained reactivity
- Theme-aware: Uses system theme colors

## 📄 License

Same as OpenCode (check main project license)

## 🎓 Credits

Created as an example/demo for the OpenCode plugin system, demonstrating:

- Custom UI components in plugins
- SolidJS integration
- Theme system usage
- Interactive widgets
- State management
- Event handling

## 📞 Support

- GitHub Issues: [OpenCode Repository]
- Documentation: Check the `.md` files in this directory
- Examples: See other plugins in `/examples/`

---

**Total Package Size**: ~57KB (code + docs)
**Setup Time**: 2 minutes
**Learning Time**: 30 minutes (basic), 2 hours (advanced)
**Working Demo**: Yes ✅
**Production Ready**: Concept/Demo stage

**Start with**: `QUICKSTART.md` → `demo.tsx` → Build something awesome! 🚀
