# SVG Preview Support with Stacked Code View

**Date**: 2026-01-03  
**Status**: Planning  
**Related Commit**: [anomalyco/opencode@5f93bee](https://github.com/anomalyco/opencode/commit/5f93beed779d754b9e84240e21578ed3c82bee3c)

## Overview

Extend the existing image preview functionality (introduced in PR #6678) to support SVG files with a stacked layout that displays both the rendered SVG preview and the source code simultaneously.

### Current State

The commit `5f93beed` added image preview support in the session viewer with the following implementation:
- Detects images via `encoding === "base64"` and `mimeType?.startsWith("image/")`
- Renders images using a data URL: `data:${mimeType};base64,${content}`
- Uses a `<Switch>` with `<Match>` components to toggle between image view and code view

### Desired Enhancement

Instead of a toggle between preview and code for SVG files:
- Render the SVG preview first
- Display the SVG source code below the preview
- Both should be visible simultaneously (stacked layout)

---

## Technical Specifications

### File Type Detection

```typescript
// SVG MIME type
const isSvg = mimeType === "image/svg+xml"

// Additional check for base64 encoded SVG
const isSvgEncoded = encoding === "base64" && mimeType === "image/svg+xml"

// SVG can also be text-based (non-base64)
const isSvgText = !encoding && mimeType === "image/svg+xml"
```

### Data Model

The `FileContent` type from `packages/opencode/src/file/index.ts:68-73`:

```typescript
{
  type: "text"
  content: string           // File content (may be base64 encoded)
  mimeType?: string         // e.g., "image/svg+xml"
  encoding?: "base64"       // Present if content is base64 encoded
  patch?: {...}             // Optional patch information
}
```

### SVG Rendering Approaches

1. **Base64 Encoded SVG**: Use data URL like other images
   ```typescript
   const svgDataUrl = `data:image/svg+xml;base64,${content}`
   // Render: <img src={svgDataUrl} alt={path} />
   ```

2. **Raw SVG Content**: Decode base64 or use directly
   ```typescript
   const svgContent = encoding === "base64" 
     ? atob(content) 
     : content
   // Option A: Use data URL with UTF-8 encoding
   const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`
   // Option B: Render inline using innerHTML (with sanitization)
   ```

### UI Layout (Stacked)

```
+------------------------------------------+
|  [SVG Preview - Rendered Image]          |
|                                          |
|  <img src="data:image/svg+xml;..." />    |
|                                          |
+------------------------------------------+
|  [SVG Source Code - Syntax Highlighted]  |
|                                          |
|  <svg xmlns="...">                       |
|    <circle cx="50" cy="50" r="40" />     |
|  </svg>                                  |
|                                          |
+------------------------------------------+
```

---

## Implementation Tasks

### Phase 1: Detection Logic

- [ ] **1.1** Add `isSvg` computed memo to detect SVG files
  - File: `packages/app/src/pages/session.tsx`
  - Location: Near existing `isImage` memo (~line 1154)
  - Logic: Check for `mimeType === "image/svg+xml"`

- [ ] **1.2** Add `svgContent` computed memo for decoded SVG source
  - Decode base64 content if `encoding === "base64"`
  - Return raw content if not encoded

- [ ] **1.3** Add `svgDataUrl` computed memo for preview rendering
  - Build data URL for the `<img>` element
  - Handle both base64 and raw SVG formats

### Phase 2: UI Components

- [ ] **2.1** Create stacked SVG preview container
  - File: `packages/app/src/pages/session.tsx`
  - Location: In the `<Switch>` block (~line 1255)
  - Add new `<Match when={state()?.loaded && isSvg()}>` case

- [ ] **2.2** Implement SVG preview section
  - Render SVG using `<img>` element with data URL
  - Add appropriate styling (max-width, padding)
  - Consider adding a subtle border or background to distinguish the preview area

- [ ] **2.3** Implement SVG source code section
  - Use the existing `codeComponent` from `useCodeComponent()`
  - Pass decoded SVG content to the code renderer
  - Ensure syntax highlighting for XML/SVG

- [ ] **2.4** Add visual separator between preview and code
  - Use a horizontal divider or spacing
  - Consider a subtle label like "Preview" and "Source"

### Phase 3: Edge Cases & Enhancements

- [ ] **3.1** Handle large SVG files gracefully
  - Consider max-height for preview with overflow scroll
  - Add loading state if decoding takes time

- [ ] **3.2** Handle malformed SVG content
  - Wrap preview in error boundary or try-catch
  - Fall back to code-only view if SVG fails to render

- [ ] **3.3** Support SVG with external resources
  - Note: External resources in data URLs are typically blocked by browsers
  - Document this limitation

- [ ] **3.4** Ensure proper encoding/decoding for special characters
  - Use `encodeURIComponent` for UTF-8 data URLs
  - Handle potential encoding edge cases

### Phase 4: Testing

- [ ] **4.1** Add test cases for SVG detection
  - Test `isSvg` with various MIME types
  - Test with base64 and non-base64 encoded content

- [ ] **4.2** Manual testing with various SVG files
  - Simple shapes
  - Complex illustrations
  - SVG with embedded CSS
  - SVG with JavaScript (should be sanitized/blocked)
  - Large SVG files
  - Malformed SVG content

---

## Code References

### Internal Files

| File | Purpose |
|------|---------|
| `packages/app/src/pages/session.tsx` | Main session viewer with file tab rendering (lines 1140-1285) |
| `packages/app/src/context/file.tsx` | File loading and state management |
| `packages/ui/src/components/code.tsx` | Code syntax highlighting component |
| `packages/ui/src/context/code.tsx` | Code component context provider |
| `packages/opencode/src/file/index.ts` | FileContent type definition (lines 68-73) |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | SDK type definitions for FileContent |

### External References

| Resource | URL | Purpose |
|----------|-----|---------|
| Original PR | https://github.com/anomalyco/opencode/pull/6678 | Image preview feature implementation |
| Commit | https://github.com/anomalyco/opencode/commit/5f93beed779d754b9e84240e21578ed3c82bee3c | Source commit for image preview |
| SVG Data URLs | https://css-tricks.com/probably-dont-base64-svg/ | Best practices for SVG encoding |
| SolidJS Docs | https://docs.solidjs.com/ | SolidJS reactivity patterns |

---

## Implementation Details

### Proposed Code Changes

#### 1. Detection Memos (`packages/app/src/pages/session.tsx`)

```typescript
// Add after existing isImage/imageDataUrl memos (~line 1162)

const isSvg = createMemo(() => {
  const c = state()?.content
  return c?.mimeType === "image/svg+xml"
})

const svgContent = createMemo(() => {
  if (!isSvg()) return
  const c = state()?.content
  if (!c?.content) return
  
  // Decode base64 if needed
  if (c.encoding === "base64") {
    try {
      return atob(c.content)
    } catch {
      return c.content
    }
  }
  return c.content
})

const svgPreviewUrl = createMemo(() => {
  if (!isSvg()) return
  const c = state()?.content
  if (!c?.content) return
  
  // For base64 encoded SVG, use base64 data URL
  if (c.encoding === "base64") {
    return `data:image/svg+xml;base64,${c.content}`
  }
  
  // For raw SVG, encode as UTF-8 data URL
  return `data:image/svg+xml;utf8,${encodeURIComponent(c.content)}`
})
```

#### 2. Stacked SVG View Component

```tsx
// Add new Match case in the Switch block (~line 1255)

<Match when={state()?.loaded && isSvg()}>
  <div class="flex flex-col gap-4 px-6 py-4 pb-40">
    {/* SVG Preview Section */}
    <div class="border border-border-weak-base rounded-lg p-4 bg-surface-base">
      <div class="text-12-medium text-text-dimmed mb-2">Preview</div>
      <div class="flex items-center justify-center">
        <img 
          src={svgPreviewUrl()} 
          alt={path()} 
          class="max-w-full max-h-96 object-contain"
        />
      </div>
    </div>
    
    {/* SVG Source Code Section */}
    <div>
      <div class="text-12-medium text-text-dimmed mb-2 px-0">Source</div>
      <Dynamic
        component={codeComponent}
        file={{
          name: path() ?? "",
          contents: svgContent() ?? "",
          cacheKey: checksum(svgContent() ?? ""),
        }}
        enableLineSelection
        selectedLines={selectedLines()}
        onLineSelected={(range: SelectedLineRange | null) => {
          const p = path()
          if (!p) return
          file.setSelectedLines(p, range)
        }}
        overflow="scroll"
        class="select-text"
      />
    </div>
  </div>
</Match>
```

---

## Validation Criteria

### Functional Requirements

- [ ] SVG files are correctly detected by MIME type
- [ ] SVG preview renders correctly in the preview section
- [ ] SVG source code displays with proper XML/SVG syntax highlighting
- [ ] Both preview and source are visible simultaneously (stacked layout)
- [ ] Base64 encoded SVG files work correctly
- [ ] Non-base64 SVG files work correctly
- [ ] Line selection works in the source code section
- [ ] Scroll position is preserved when switching tabs

### Visual Requirements

- [ ] Clear visual separation between preview and source sections
- [ ] Preview section has appropriate styling (border, background)
- [ ] Source code has consistent styling with other file types
- [ ] Responsive layout works on different screen sizes

### Error Handling

- [ ] Malformed SVG files gracefully fall back to code-only view
- [ ] Large SVG files don't cause performance issues
- [ ] Missing content is handled without crashing

---

## Dependencies

- No new external dependencies required
- Uses existing:
  - `@opencode-ai/ui/context/code` - Code component
  - `@opencode-ai/util/encode` - Checksum utility
  - SolidJS primitives (`createMemo`, `Show`, `Match`, etc.)

---

## Risks & Considerations

1. **Security**: Inline SVG rendering could potentially execute malicious JavaScript. Using `<img src="data:...">` mitigates this as scripts are not executed in `<img>` elements.

2. **Performance**: Very large SVG files might cause performance issues. Consider:
   - Adding a size limit for preview rendering
   - Lazy loading the preview

3. **Encoding Issues**: Special characters in SVG content need proper URL encoding. Use `encodeURIComponent()` for UTF-8 data URLs.

4. **Browser Compatibility**: Data URLs with SVG content are widely supported, but there may be edge cases with certain SVG features.

---

## Future Enhancements

- [ ] Add zoom controls for SVG preview
- [ ] Add "Copy SVG" button
- [ ] Add "Download SVG" button
- [ ] Support SVG editing in-place with live preview
- [ ] Add dark/light background toggle for SVG preview
