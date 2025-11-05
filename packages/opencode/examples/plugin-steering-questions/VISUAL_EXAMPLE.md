# Visual Example: Steering Questions Widget

This document shows what the steering questions widget looks like in the OpenCode TUI.

## Widget Appearance

```
┌─────────────────────────────────────────────────────────────────┐
│ Project Configuration Questions                                 │
│                                                                  │
│ ● Architecture  ○ Styling  ○ Testing  ○ Deployment             │
│                                                                  │
│ Framework:                                                       │
│ ◉ React  ○ Vue  ○ Svelte  ○ Vanilla                           │
│                                                                  │
│ State Management:                                                │
│ ○ Context  ○ Redux  ◉ Zustand  ○ Jotai                        │
│                                                                  │
│ ▶ Submit Answers (2 selected)                                   │
└─────────────────────────────────────────────────────────────────┘
```

## With Multiple Tabs Active

### Architecture Tab (Active)

```
┌─────────────────────────────────────────────────────────────────┐
│ Project Configuration Questions                                 │
│                                                                  │
│ ● Architecture  ○ Styling  ○ Testing  ○ Deployment             │
│                                                                  │
│ Framework:                                                       │
│ ◉ React  ○ Vue  ○ Svelte  ○ Vanilla                           │
│                                                                  │
│ State Management:                                                │
│ ◉ Context  ○ Redux  ○ Zustand  ○ Jotai                        │
└─────────────────────────────────────────────────────────────────┘
```

### Styling Tab (Active)

```
┌─────────────────────────────────────────────────────────────────┐
│ Project Configuration Questions                                 │
│                                                                  │
│ ○ Architecture  ● Styling  ○ Testing  ○ Deployment             │
│                                                                  │
│ CSS Approach:                                                    │
│ ☑ Tailwind  ☑ CSS Modules  ☐ Styled Components  ☐ SCSS        │
│                                                                  │
│ Theme System:                                                    │
│ ◉ Light/Dark  ○ Multiple Themes  ○ Custom  ○ None             │
└─────────────────────────────────────────────────────────────────┘
```

## After Submission

```
┌─────────────────────────────────────────────────────────────────┐
│ Project Configuration Questions                                 │
│                                                                  │
│ ✓ Configuration Submitted                                       │
│ Selected 8 options across all tabs                              │
│                                                                  │
│ framework: React                                                 │
│ state: Context                                                   │
│ css: Tailwind, CSS Modules                                      │
│ theme: Light/Dark                                               │
│ unit: Vitest                                                     │
│ e2e: Playwright                                                  │
│ platform: Vercel                                                 │
│ ci: GitHub Actions                                              │
└─────────────────────────────────────────────────────────────────┘
```

## In Message Stream Context

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ YOU (2:30 PM)                                                   │
│ Build me a modern web application for task management           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ I'd be happy to help! Let me gather some requirements first.    │
│                                                                  │
│ [GENERAL] claude-3-5-sonnet                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Project Configuration Questions                                 │
│                                                                  │
│ ● Architecture  ○ Styling  ○ Testing  ○ Deployment             │
│                                                                  │
│ Framework:                                                       │
│ ◉ React  ○ Vue  ○ Svelte  ○ Vanilla                           │
│                                                                  │
│ State Management:                                                │
│ ◉ Zustand  ○ Redux  ○ Context  ○ Jotai                        │
│                                                                  │
│ ▶ Submit Answers (2 selected)                                   │
└─────────────────────────────────────────────────────────────────┘

[User clicks Submit]

┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│ Perfect! Based on your choices:                                  │
│                                                                  │
│ ✓ React with TypeScript                                         │
│ ✓ Zustand for state management                                  │
│ ✓ Tailwind CSS for styling                                      │
│ ✓ Vitest for testing                                            │
│ ✓ Deployed on Vercel                                            │
│                                                                  │
│ Let me create the project structure...                          │
│                                                                  │
│ [GENERAL] claude-3-5-sonnet                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Interaction States

### Hover State

```
Framework:
◉ React  ○ Vue  ○ Svelte  ○ Vanilla
     ↑
  (mouse over - color changes to accent)
```

### Selected State

```
◉ React         (selected - accent color)
○ Vue           (not selected - muted gray)
```

### Multi-Choice

```
☑ Tailwind           (selected - accent color)
☑ CSS Modules        (selected - accent color)
☐ Styled Components  (not selected - muted gray)
☐ SCSS              (not selected - muted gray)
```

### Submit Button States

**Before Selection:**

```
○ Submit Answers (select at least one)
     ↑
  (gray - disabled look)
```

**With Selections:**

```
▶ Submit Answers (5 selected)
     ↑
  (green/success color - clickable)
```

**After Submit:**

```
✓ Configuration Submitted
     ↑
  (green - confirmed)
```

## Color Scheme

Using default OpenCode theme:

- **Accent Blue** (`#0088ff`): Selected options, active tab, submit button
- **Success Green** (`#00ff00`): Submit button (hover), confirmation
- **Text White** (`#ffffff`): Primary text
- **Muted Gray** (`#808080`): Unselected options, secondary text
- **Background Panel** (`#1a1a1a`): Widget background
- **Error Red** (`#ff0000`): Required field indicators

## Layout Structure

```
Widget Container (bordered box)
├── Title (bold, accent color)
├── Description (muted, optional)
├── Tab Navigation (horizontal row)
│   ├── Tab 1 (● active / ○ inactive)
│   ├── Tab 2
│   ├── Tab 3
│   └── Tab 4
├── Questions (vertical stack)
│   ├── Question 1
│   │   ├── Label (with * if required)
│   │   └── Options (horizontal wrap)
│   ├── Question 2
│   │   ├── Label
│   │   └── Options
│   └── ...
└── Submit Button (bottom)
```

## Responsive Behavior

### Wide Terminal (>120 chars)

```
○ React  ○ Vue  ○ Svelte  ○ Vanilla  ○ Next.js  ○ Nuxt
(all options on one line)
```

### Narrow Terminal (<80 chars)

```
○ React
○ Vue
○ Svelte
○ Vanilla
(stacked vertically)
```

## Accessibility Features

- **Mouse Interaction**: Click to select/deselect
- **Visual Indicators**: Clear selected vs unselected states
- **Color Coding**: Uses theme colors for consistency
- **Hover Feedback**: Visual confirmation of clickable elements
- **Required Fields**: Asterisk (\*) indicator
- **Submit Validation**: Button disabled until requirements met

## Integration Points

### Sidebar Widget

- Appears in right sidebar under "Tools" section
- Listed as "Steering Q&A Demo"
- Always available for testing/demo purposes

### Message Stream Widget

- Appears inline between messages
- Triggered by model output
- Answers flow back into conversation
- Widget state persists until submission

## Technical Notes

### SolidJS Reactivity

```typescript
const [activeTab, setActiveTab] = createSignal<TabId>("arch")
const [answers, setAnswers] = createSignal<Record<string, any>>({})
const [submitted, setSubmitted] = createSignal(false)
```

### Theme Integration

```typescript
<text fg={theme.accent}>Selected Option</text>
<text fg={theme.textMuted}>Unselected Option</text>
<box backgroundColor={theme.backgroundPanel}>...</box>
```

### Event Handling

```typescript
<text onMouseUp={() => handleSelect(option)}>
  {isSelected ? "◉" : "○"} {option}
</text>
```

## Comparison to Traditional Chat

### Traditional Chat Flow

```
User: "Build a web app"
AI: "What framework?"
User: "React"
AI: "State management?"
User: "Zustand"
AI: "Styling?"
User: "Tailwind"
AI: "Testing?"
User: "Vitest"
```

(4 back-and-forth exchanges)

### With Steering Questions

```
User: "Build a web app"
AI: [Shows widget with all questions]
User: [Selects all options at once]
AI: "Got it! Starting implementation..."
```

(1 interaction)

**Result**: 75% reduction in message count, faster to completion, clearer requirements.
