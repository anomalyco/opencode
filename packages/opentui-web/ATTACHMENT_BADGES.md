# Attachment Badges in TerminalInput

## Overview

The `TerminalInput` component now supports displaying attachments as inline badges (like `[Image 1]`), matching the design shown in the OpenCode CLI reference.

## Visual Design

```
> [Image 1] your text here█
```

- **Badge**: Orange background (#d19a66) with black text (#000000)
- **Format**: `[Label]` wrapped in brackets
- **Position**: Appears before the user's text input
- **Multiple**: Can display multiple badges in sequence

## Usage

### Import Types

```typescript
import { TerminalInput, type Attachment } from "@opencode-ai/opentui-web"
```

### Define Attachments

```typescript
const [attachments, setAttachments] = createSignal<Attachment[]>([
  { type: "image", label: "Image 1" },
  { type: "file", label: "data.json" },
])
```

### Render with Attachments

```typescript
<TerminalInput
  value={inputText()}
  onInput={setInputText}
  onSubmit={handleSubmit}
  attachments={attachments()}
  width={74}
/>
```

## Attachment Type

```typescript
export interface Attachment {
  type: "image" | "file" // Type of attachment
  label: string // Display label (shown in badge)
}
```

## Examples

### Single Image

```typescript
attachments={[{ type: "image", label: "Image 1" }]}
```

Renders: `> [Image 1] █`

### Multiple Attachments

```typescript
attachments={[
  { type: "image", label: "Image 1" },
  { type: "image", label: "Image 2" },
  { type: "file", label: "config.json" }
]}
```

Renders: `> [Image 1] [Image 2] [config.json] █`

### With User Input

```typescript
attachments={[{ type: "image", label: "Screenshot" }]}
value="Analyze this"
```

Renders: `> [Screenshot] Analyze this█`

## Implementation Details

### Badge Rendering

- Each badge is rendered as a `GridText` component
- Background: `#d19a66` (orange)
- Foreground: `#000000` (black)
- Bold text for emphasis
- Automatic spacing between badges

### Cursor Positioning

The cursor position automatically adjusts based on:

1. Prompt character (col 0)
2. All attachment badges
3. User input text
4. Cursor appears at the end: `col = 2 + sum(badge_lengths) + text.length`

### Grid Layout

```
Col:  0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16
Data: >     [  I  m  a  g  e     1  ]     t  e  x  t  █
```

## Color Reference

| Element  | Hex Color | Purpose                      |
| -------- | --------- | ---------------------------- |
| Badge BG | #d19a66   | Orange background for badges |
| Badge FG | #000000   | Black text on orange         |
| Prompt   | #e5c07b   | Orange prompt `>`            |
| Cursor   | #d19a66   | Orange cursor block          |
| Text     | #ffffff   | White input text             |

## Use Cases

### 1. Image Attachments

```typescript
{ type: "image", label: "Image 1" }
{ type: "image", label: "Screenshot 2025-11-10" }
{ type: "image", label: "diagram.png" }
```

### 2. File Attachments

```typescript
{ type: "file", label: "data.json" }
{ type: "file", label: "config.yaml" }
{ type: "file", label: "report.pdf" }
```

### 3. Mixed Attachments

```typescript
;[
  { type: "image", label: "Before" },
  { type: "image", label: "After" },
  { type: "file", label: "analysis.csv" },
]
```

## Integration with MessagesPanel

To integrate with the messages panel, track attachments in state:

```typescript
const [inputText, setInputText] = createSignal("")
const [attachments, setAttachments] = createSignal<Attachment[]>([])

// Add attachment
const addImage = (path: string, label: string) => {
  setAttachments(prev => [...prev, { type: "image", label }])
}

// Remove attachment
const removeAttachment = (index: number) => {
  setAttachments(prev => prev.filter((_, i) => i !== index))
}

// Clear on submit
const handleSubmit = (text: string) => {
  console.log("Submitting:", text, "with attachments:", attachments())
  setInputText("")
  setAttachments([])
}

<TerminalInput
  value={inputText()}
  onInput={setInputText}
  onSubmit={handleSubmit}
  attachments={attachments()}
/>
```

## Future Enhancements

- [ ] Click badge to remove attachment
- [ ] Drag & drop files to add attachments
- [ ] Different colors for different attachment types
- [ ] Badge icons (📷 for images, 📄 for files)
- [ ] Hover to show full file path
- [ ] Badge animations on add/remove

## Demo

See `src/examples/TerminalInputDemo.tsx` for a working example with toggle button to show/hide attachments.

```bash
cd packages/opentui-web
npm run dev
```
