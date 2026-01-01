# Browser Context Bar Design

**Date**: 2025-01-01  
**Status**: Approved  
**Author**: AI + Jordan

## Overview

Add a minimal bottom action bar to the Eidorail extension sidepanel that enables users to capture browser context (screenshots, page content, selections) and inject it into AI chat platforms.

## Goals

1. **Seamless integration** - Feel like a natural part of the chat experience, not a bolt-on
2. **Markdown-first** - Page content captured with formatting preserved (links, headings, code)
3. **Minimal footprint** - 36px bar, always visible, non-intrusive
4. **Cross-platform** - Works with all embedded AI platforms (OpenCode, Claude, ChatGPT, etc.)

## Non-Goals

- Full web clipping/archiving (use markdownload for that)
- File uploads (defer to later iteration)
- Cross-window tab access (current window only for v1)

## Design

### UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                     [Platform iframe]                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 🌐 README.md - sst/opencode  [▾]     [📷] [📄] [📋]             │
└─────────────────────────────────────────────────────────────────┘
     │                          │       │    │    │
     └─ current tab title       │       │    │    └─ selection → markdown
                                │       │    └─ page → markdown
                                │       └─ screenshot
                                └─ tab picker dropdown
```

**Dimensions**: 36px height, full width, dark theme matching sidepanel

### Components

#### 1. Current Tab Display

- Shows favicon + truncated title of the "target" tab
- Defaults to the active browser tab
- Clicking opens tab picker dropdown

#### 2. Tab Picker Dropdown

```
┌──────────────────────────────────────┐
│ 🔍 Search tabs...                    │
├──────────────────────────────────────┤
│ ▼ Work (blue)           ← tab group  │
│   📄 GitHub - sst/opencode           │
│   💬 Slack - #engineering            │
├──────────────────────────────────────┤
│ ▼ Research (green)                   │
│   📚 Stack Overflow...               │
│   📖 MDN Web Docs...                 │
├──────────────────────────────────────┤
│   🤖 Claude.ai          ← ungrouped  │
│   🤖 ChatGPT                         │
└──────────────────────────────────────┘
```

Features:

- Grouped by Chrome tab groups (with color indicator)
- Search/filter input
- Favicons for recognition
- Current selection highlighted

#### 3. Action Buttons

| Button     | Icon | Action                            | Output          |
| ---------- | ---- | --------------------------------- | --------------- |
| Screenshot | 📷   | `chrome.tabs.captureVisibleTab()` | PNG data URL    |
| Page       | 📄   | Readability + Turndown            | Markdown string |
| Selection  | 📋   | Get selection HTML → Turndown     | Markdown string |

### Interaction Flow

1. **User clicks action button**
2. **Capture phase** (200ms max)
   - Button shows spinner
   - Content script extracts content from target tab
3. **Success**
   - Button shows checkmark ✓ briefly
   - Content copied to clipboard
   - Attempt auto-insert into active platform's input field
4. **Error**
   - Button flashes red
   - Toast notification with error message

### Auto-Insert Strategy

Try to paste content into the chat input:

1. **postMessage to iframe** with captured content
2. **Platform-specific handlers** in content scripts detect message
3. **Insert into input** field (textarea, contenteditable, etc.)
4. **Fallback**: If auto-insert fails, content is still on clipboard

### Markdown Output Format

#### Page Capture

````markdown
# Page Title

> **Source**: https://github.com/sst/opencode  
> **Captured**: 2025-01-01 10:30 AM

[Article content with preserved formatting...]

## Headings preserved

- Lists preserved
- [Links preserved](https://example.com)
- `code` preserved

`code blocks preserved`
````

#### Selection Capture

```markdown
> Selected from [Page Title](https://example.com/page)

[Selected content as markdown...]
```

#### Screenshot

```markdown
![Screenshot of Page Title](data:image/png;base64,...)
```

## Technical Implementation

### Libraries

| Library        | Version | Purpose                 | License    |
| -------------- | ------- | ----------------------- | ---------- |
| Readability.js | 0.5.0   | Extract article content | Apache 2.0 |
| Turndown       | 7.1.3   | HTML → Markdown         | MIT        |

### Files to Create

```
packages/extension/
├── utils/
│   ├── markdown-converter.ts    # Turndown wrapper with custom rules
│   ├── page-capture.ts          # Readability integration
│   └── browser-context.ts       # Tab list, screenshots, selection
├── entrypoints/
│   ├── page-context.content.ts  # Content script for page extraction
│   └── sidepanel/
│       ├── ContextBar.tsx       # Main bar component
│       └── TabPicker.tsx        # Dropdown component
└── libs/
    ├── readability.min.js       # Vendored (or npm)
    └── turndown.min.js          # Vendored (or npm)
```

### Content Script Communication

```typescript
// Background script receives capture request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "capture-page") {
    // Execute content script in target tab
    chrome.scripting
      .executeScript({
        target: { tabId: msg.tabId },
        func: extractPageContent,
      })
      .then((results) => {
        sendResponse({ success: true, content: results[0].result })
      })
    return true // async response
  }
})
```

### Permissions Required

Already have in manifest:

- `tabs` - Tab list access
- `activeTab` - Current tab info
- `scripting` - Execute content scripts

May need to add:

- `clipboardWrite` - Copy to clipboard (if not using `navigator.clipboard`)

## CSS Variables

```css
/* Context bar - matches existing sidepanel theme */
--context-bar-bg: #1a1717;
--context-bar-border: #3d3a3a;
--context-bar-text: #c8c5c5;
--context-bar-icon: #8b8888;
--context-bar-icon-hover: #e08a30;
--context-bar-height: 36px;
```

## States & Edge Cases

| State                            | Handling                                |
| -------------------------------- | --------------------------------------- |
| No active tab                    | Show "No tab selected"                  |
| Tab is loading                   | Disable capture buttons                 |
| Protected page (chrome://, etc.) | Show tooltip "Cannot capture this page" |
| Selection is empty               | Disable selection button                |
| Capture timeout                  | Show error, suggest retry               |
| Large page content               | Truncate with "... [truncated]" marker  |

## Future Enhancements (v2+)

- [ ] File upload via drag & drop
- [ ] Cross-window tab access
- [ ] Capture history/recents
- [ ] Custom markdown templates
- [ ] Image compression options
- [ ] Keyboard shortcuts (Cmd+Shift+S for screenshot, etc.)

## Testing Checklist

- [ ] Screenshot captures correctly
- [ ] Page markdown preserves links and formatting
- [ ] Selection capture works with various HTML
- [ ] Tab picker shows correct groups and colors
- [ ] Auto-insert works with OpenCode
- [ ] Clipboard fallback works when auto-insert fails
- [ ] Error states display correctly
- [ ] Works at narrow sidebar widths (300px)
