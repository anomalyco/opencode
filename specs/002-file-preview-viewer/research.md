# Research: File Preview Viewer

**Feature**: 002-file-preview-viewer
**Date**: 2026-01-14

## Research Topics

### 1. Existing File Loading Mechanism

**Decision**: Use existing `sdk.client.file.read()` via `local.tsx` context

**Rationale**:
- Already implemented and battle-tested in codebase
- Handles file reading through SDK with proper error handling
- Supports reactive updates via `sdk.event.listen()` for file watcher events
- Content returned as `FileContent` type (text content with encoding info)

**Alternatives considered**:
- Direct Tauri file system API: Would bypass SDK abstractions and duplicate code
- Fetch API: Not applicable for local files in desktop context

**Implementation details**:
```typescript
// From packages/app/src/context/local.tsx:394-416
const load = async (path: string) => {
  const relativePath = relative(path)
  await sdk.client.file
    .read({ path: relativePath })
    .then((x) => {
      setStore("node", relativePath, produce((draft) => {
        draft.loaded = true
        draft.content = x.data  // FileContent type
      }))
    })
    .catch((e) => {
      showToast({ variant: "error", title: "Failed to load file", description: e.message })
    })
}
```

---

### 2. Markdown Rendering Approach

**Decision**: Reuse existing `Markdown` component from `packages/ui/src/components/markdown.tsx`

**Rationale**:
- Already implements secure markdown rendering with DOMPurify sanitization
- Includes Shiki syntax highlighting for code blocks via Marked
- Has LRU caching (200 entries) for performance
- Handles async parsing with Solid.js `createResource`

**Alternatives considered**:
- New markdown library (e.g., remark/rehype): Would add dependencies and duplicate security measures
- Raw HTML rendering: Security risk without sanitization

**Key features of existing component**:
- Uses `marked.parse()` for markdown→HTML conversion
- Sanitizes with DOMPurify config: `USE_PROFILES: { html: true, mathMl: true }`
- Forbids `<style>` and `<script>` tags
- Adds `noopener noreferrer` to external links

---

### 3. HTML Preview Sandboxing

**Decision**: Use `<iframe>` with `sandbox` attribute and `srcdoc` for HTML preview

**Rationale**:
- Browser-native security model for untrusted content
- `sandbox` attribute disables scripts, forms, popups by default
- `srcdoc` avoids network requests by embedding content directly
- Compatible with both Tauri WebView and standard browsers

**Alternatives considered**:
- DOMPurify-only approach: Insufficient for complex HTML; doesn't prevent all XSS vectors in rendered content
- Shadow DOM: Doesn't provide script isolation
- Tauri-specific webview: Would only work on desktop; adds complexity

**Implementation approach**:
```tsx
<iframe
  sandbox="allow-same-origin"  // Allows CSS to work, but no scripts
  srcdoc={sanitizedHtml}
  class="w-full h-full border-none"
/>
```

**Security measures**:
1. Pre-sanitize with DOMPurify before embedding
2. Use `sandbox` attribute (scripts disabled by default)
3. Block external resource loading via CSP-like restrictions
4. Convert relative image paths to data URLs or block them

---

### 4. File Type Detection

**Decision**: Use file extension mapping

**Rationale**:
- Simple, fast, and reliable for the supported file types
- Consistent with existing `FileIcon` component approach
- Extensions are explicit: `.txt`, `.md`, `.html`, `.htm`

**Alternatives considered**:
- MIME type detection: Requires file header reading; overkill for text-based formats
- Content sniffing: Security risk; unreliable for text formats

**Implementation**:
```typescript
const SUPPORTED_EXTENSIONS = {
  text: ['.txt'],
  markdown: ['.md', '.markdown'],
  html: ['.html', '.htm'],
} as const

function getPreviewType(filename: string): 'text' | 'markdown' | 'html' | null {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()
  if (SUPPORTED_EXTENSIONS.text.includes(ext)) return 'text'
  if (SUPPORTED_EXTENSIONS.markdown.includes(ext)) return 'markdown'
  if (SUPPORTED_EXTENSIONS.html.includes(ext)) return 'html'
  return null
}
```

---

### 5. Preview Panel Layout

**Decision**: Inline panel below file tree in `WorkspaceSidebar`, expandable/collapsible

**Rationale**:
- Keeps file explorer and preview co-located for quick browsing
- Follows existing sidebar patterns in the app
- No major layout changes required
- Can be expanded to full height or collapsed

**Alternatives considered**:
- Modal dialog: Disrupts workflow; requires dismissal
- Separate tab/panel: Adds navigation complexity
- Replace file tree: Loses context during preview

**Layout structure**:
```
WorkspaceSidebar
├── Header ("Files" + close button)
├── FileTree (scrollable)
└── FilePreview (collapsible, resizable height)
    ├── Preview header (filename + collapse button)
    └── Preview content (text/markdown/html)
```

---

### 6. Large File Handling

**Decision**: Show first 100KB with warning for files > 1MB

**Rationale**:
- Prevents UI freezing on very large files
- 100KB provides sufficient preview for most use cases
- Warning informs user of truncation
- 5MB hard limit protects against memory issues

**Alternatives considered**:
- Virtual scrolling: Complex to implement for markdown/HTML rendering
- Pagination: Awkward UX for text preview
- Full loading with spinner: Poor UX for multi-MB files

**Implementation**:
```typescript
const MAX_PREVIEW_SIZE = 100 * 1024  // 100KB
const WARNING_SIZE = 1 * 1024 * 1024  // 1MB

function prepareContent(content: string, fileSize: number) {
  const truncated = content.length > MAX_PREVIEW_SIZE
  const showWarning = fileSize > WARNING_SIZE
  return {
    content: truncated ? content.slice(0, MAX_PREVIEW_SIZE) : content,
    truncated,
    showWarning,
  }
}
```

---

### 7. Error State Handling

**Decision**: Show user-friendly error messages in preview panel

**Rationale**:
- Consistent with existing `showToast` pattern for errors
- Keeps user in context (no modal dismissal needed)
- Provides actionable information when possible

**Error states to handle**:
1. File not found (deleted after selection)
2. Read permission denied
3. Binary file detected
4. Encoding error (non-UTF-8)
5. File too large

**Implementation pattern**:
```tsx
<Show when={error()} fallback={<PreviewContent />}>
  <div class="flex flex-col items-center justify-center h-full text-text-muted">
    <IconWarning class="w-8 h-8 mb-2" />
    <span class="text-sm">{error()?.message}</span>
  </div>
</Show>
```

---

## Summary

All technical decisions leverage existing codebase patterns:
- **File loading**: SDK via `local.tsx` (existing)
- **Markdown**: Reuse `Markdown` component (existing)
- **HTML sandboxing**: iframe with `sandbox` + DOMPurify (new, follows existing security patterns)
- **Layout**: Extend `WorkspaceSidebar` (minimal changes)

No new external dependencies required. Implementation follows Solid.js reactive patterns established in codebase.
