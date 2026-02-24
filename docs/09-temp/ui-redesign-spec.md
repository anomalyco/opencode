# UI Redesign Spec

## Reference Design
See HTML mockup provided by user. Key elements:

### Sidebar
- "New Session" button with icon, primary color border
- "RECENT CHATS" section header (uppercase, tracking-wider)
- Chat items with icon + title + timestamp
- "CONTEXT" section with file list
- Bottom: plan usage bar

### Message Timeline
- Assistant: Robot icon (32x32 rounded square) + "OPENCODE AI" label (uppercase, primary color, bold)
- User: Timestamp + "You" label (accent-cyan color, bold)
- User message: Glass panel, rounded-2xl with rounded-tr-none

### Thinking Block
- Collapsible `<details>` with:
  - Cyan pulsing dot + "Thinking process..." text
  - Expand/collapse arrow
  - Mono font content with `>` prefix
  - Border-top separator

### Prompt Input
- Glass panel with backdrop-blur
- Model selector pills ("GPT-4o", "Web Search")
- Textarea
- Send button with primary color + glow shadow
- Bottom bar: keyboard shortcuts + sync status

### Right Activity Bar
- Vertical icon strip: Extensions, Source Control, History
- Bottom: Settings + user avatar

### Settings (from screenshot)
- Already looks reasonable, minor polish needed
