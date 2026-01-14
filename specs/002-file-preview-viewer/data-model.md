# Data Model: File Preview Viewer

**Feature**: 002-file-preview-viewer
**Date**: 2026-01-14

## Entities

### 1. PreviewState

Represents the current state of the file preview panel.

| Field | Type | Description |
|-------|------|-------------|
| `selectedFile` | `LocalFile \| null` | Currently selected file for preview |
| `previewType` | `'text' \| 'markdown' \| 'html' \| null` | Detected preview type based on extension |
| `content` | `string \| null` | File content (may be truncated for large files) |
| `loading` | `boolean` | Whether content is being loaded |
| `error` | `PreviewError \| null` | Error state if preview failed |
| `expanded` | `boolean` | Whether preview panel is expanded |
| `truncated` | `boolean` | Whether content was truncated due to size |

### 2. PreviewError

Represents an error state in the preview panel.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `PreviewErrorType` | Category of error |
| `message` | `string` | User-friendly error message |

**PreviewErrorType enum**:
- `'not_found'` - File was deleted or doesn't exist
- `'permission_denied'` - Cannot read file
- `'binary_file'` - File appears to be binary, not text
- `'encoding_error'` - File encoding not supported
- `'file_too_large'` - File exceeds 5MB limit
- `'unsupported_type'` - File extension not supported for preview

### 3. SupportedExtensions (Constants)

| Category | Extensions |
|----------|------------|
| `text` | `.txt` |
| `markdown` | `.md`, `.markdown` |
| `html` | `.html`, `.htm` |

## Existing Types (Referenced)

### LocalFile (from `packages/app/src/context/local.tsx`)

```typescript
export type LocalFile = FileNode & Partial<{
  loaded: boolean
  pinned: boolean
  expanded: boolean
  content: FileContent
  selection: TextSelection
  scrollTop: number
  view: View
  folded: string[]
  selectedChange: number
  status: FileStatus
}>
```

### FileContent (from SDK)

```typescript
type FileContent = {
  text: string
  encoding?: string
}
```

### FileNode (from SDK)

```typescript
type FileNode = {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
}
```

## State Flow

```
User clicks file in FileTree
        │
        ▼
WorkspaceSidebar.onFileClick(file: LocalFile)
        │
        ▼
┌───────────────────────────────────┐
│  getPreviewType(file.name)        │
│  Returns: 'text'|'markdown'|'html'│null
└───────────────────────────────────┘
        │
        ├─── null ──► Show "unsupported" message
        │
        ▼ (supported)
┌───────────────────────────────────┐
│  Check file.content               │
│  If not loaded: await local.file.load(path)
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│  Validate content                 │
│  - Check size (< 5MB)             │
│  - Detect binary                  │
│  - Truncate if > 100KB            │
└───────────────────────────────────┘
        │
        ├─── Error ──► Set PreviewError
        │
        ▼ (valid)
┌───────────────────────────────────┐
│  Render preview                   │
│  - text: <pre> with scrolling     │
│  - markdown: <Markdown> component │
│  - html: sandboxed <iframe>       │
└───────────────────────────────────┘
```

## Relationships

```
WorkspaceSidebar
    │
    ├──► FileTree (child)
    │       │
    │       └──► onFileClick(LocalFile) ───┐
    │                                       │
    └──► FilePreview (child)  ◄─────────────┘
            │
            ├──► TextPreview (conditional)
            │       Uses: LocalFile.content.text
            │
            ├──► MarkdownPreview (conditional)
            │       Uses: Markdown component + LocalFile.content.text
            │
            └──► HtmlPreview (conditional)
                    Uses: iframe + DOMPurify + LocalFile.content.text
```

## Validation Rules

### File Size
- **Warning threshold**: 1MB - Show warning but continue preview
- **Hard limit**: 5MB - Show error, refuse to preview

### Content Truncation
- **Preview limit**: 100KB - Truncate with indicator for larger files

### Binary Detection
- Check first 8KB for null bytes
- If null bytes found: Show binary file error

### Encoding
- Default: UTF-8
- Fallback: Try ASCII if UTF-8 fails
- Error: Show encoding error if neither works

## Component Props

### FilePreview

```typescript
interface FilePreviewProps {
  file: LocalFile | null
  class?: string
  onClose?: () => void
}
```

### TextPreview

```typescript
interface TextPreviewProps {
  content: string
  truncated?: boolean
}
```

### HtmlPreview

```typescript
interface HtmlPreviewProps {
  content: string
  basePath?: string  // For resolving relative paths
}
```

### MarkdownPreview (uses existing Markdown)

```typescript
interface MarkdownPreviewProps {
  text: string
  class?: string
}
// Existing Markdown component handles this
```
