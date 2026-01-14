# Quickstart: File Preview Viewer

**Feature**: 002-file-preview-viewer
**Date**: 2026-01-14

## Overview

This feature adds file preview capability to the workspace sidebar. When users click on supported file types (.txt, .md, .html, .htm), the content is displayed in a preview panel below the file tree.

## Prerequisites

- Working development environment with `bun` installed
- Repository cloned and dependencies installed

```bash
bun install
```

## Development Workflow

### 1. Start Development Server

```bash
# Web development (hot reload)
cd packages/app
bun dev

# Desktop development (Tauri)
cd packages/desktop
bun tauri dev
```

### 2. Key Files to Modify

| File | Purpose |
|------|---------|
| `packages/app/src/components/workspace-sidebar.tsx` | Add preview panel integration |
| `packages/app/src/components/file-preview/file-preview.tsx` | Main preview container (NEW) |
| `packages/app/src/components/file-preview/text-preview.tsx` | Plain text renderer (NEW) |
| `packages/app/src/components/file-preview/html-preview.tsx` | Sandboxed HTML renderer (NEW) |

### 3. Key Files to Reference

| File | Purpose |
|------|---------|
| `packages/ui/src/components/markdown.tsx` | Existing markdown renderer (REUSE) |
| `packages/app/src/context/local.tsx` | File loading via SDK (USE AS-IS) |
| `packages/ui/src/components/dialog.tsx` | Kobalte dialog patterns (REFERENCE) |

## Implementation Steps

### Step 1: Create FilePreview Component Structure

```bash
mkdir -p packages/app/src/components/file-preview
```

Create the main preview container that:
1. Accepts `LocalFile` from parent
2. Detects file type by extension
3. Routes to appropriate renderer
4. Handles loading/error states

### Step 2: Implement Text Preview

Simple component that:
- Wraps content in `<pre>` tag
- Adds monospace styling
- Shows truncation indicator if needed

### Step 3: Implement HTML Preview

Sandboxed iframe approach:
1. Sanitize HTML with DOMPurify
2. Render in iframe with `sandbox` attribute
3. Block external resources

### Step 4: Integrate with WorkspaceSidebar

Modify `workspace-sidebar.tsx` to:
1. Track selected file for preview
2. Render `FilePreview` component below file tree
3. Handle panel expand/collapse

## Testing Checklist

### Manual Testing

- [ ] Click `.txt` file → shows plain text
- [ ] Click `.md` file → shows rendered markdown with headings, code blocks
- [ ] Click `.html` file → shows rendered HTML (no scripts execute)
- [ ] Click unsupported file → shows "unsupported" message
- [ ] Click large file (>1MB) → shows warning
- [ ] Switch between files → preview updates
- [ ] Delete file while previewing → shows "not found" error

### Test Files to Create

Create test files in any workspace:

```bash
# Text file
echo "Hello, World!" > test.txt

# Markdown file
cat > test.md << 'EOF'
# Heading 1
## Heading 2

- List item 1
- List item 2

```code
const x = 1
```
EOF

# HTML file
cat > test.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <style>body { color: blue; }</style>
</head>
<body>
  <h1>Test HTML</h1>
  <script>alert('This should not execute')</script>
</body>
</html>
EOF
```

## Architecture Notes

### Component Hierarchy

```
WorkspaceSidebar
├── Header
├── FileTree
│   └── (handles file selection)
└── FilePreview
    ├── PreviewHeader (filename, collapse button)
    └── PreviewContent
        ├── TextPreview (for .txt)
        ├── Markdown (for .md - existing component)
        └── HtmlPreview (for .html/.htm)
```

### Data Flow

```
User clicks file
    ↓
FileTree.onFileClick(file)
    ↓
WorkspaceSidebar sets selectedFile
    ↓
FilePreview receives file prop
    ↓
If file.content not loaded:
    → local.file.load(path)
    → Wait for content
    ↓
Detect type, render appropriate preview
```

### Security Considerations

1. **Markdown**: Already sanitized by existing `Markdown` component via DOMPurify
2. **HTML**: Double protection:
   - Pre-sanitize with DOMPurify
   - Render in sandboxed iframe (scripts disabled)
3. **Text**: No security concerns (rendered as plain text)

## Common Patterns in Codebase

### Solid.js Reactive Pattern

```typescript
// Use createSignal for local state
const [selectedFile, setSelectedFile] = createSignal<LocalFile | null>(null)

// Use Show for conditional rendering
<Show when={selectedFile()} fallback={<EmptyState />}>
  <FilePreview file={selectedFile()!} />
</Show>

// Use createResource for async data
const [content] = createResource(
  () => file().path,
  async (path) => await local.file.load(path)
)
```

### CSS Styling Pattern

```tsx
// Use Tailwind classes
<div class="flex flex-col border-l border-border-weak-base bg-background-base">

// Use data attributes for component targeting
<div data-component="file-preview" data-slot="container">
```

### Error Handling Pattern

```typescript
import { showToast } from "@opencode-ai/ui/toast"

try {
  await sdk.client.file.read({ path })
} catch (e) {
  showToast({
    variant: "error",
    title: "Failed to load file",
    description: e.message,
  })
}
```

## Troubleshooting

### File not loading

Check browser console for SDK errors. Ensure file path is relative to project root.

### Markdown not rendering

Verify `MarkedProvider` is in component tree. Check `packages/ui/src/context/marked.tsx`.

### HTML scripts executing

Verify `sandbox` attribute is present on iframe. Never use `sandbox="allow-scripts"`.

### Styles not applying

Check Tailwind class names. Ensure CSS variables from theme are available.
