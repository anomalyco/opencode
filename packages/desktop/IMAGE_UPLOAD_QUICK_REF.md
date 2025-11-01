# Image Upload - Quick Reference for Implementation

## Files to Edit

**Single file:** `src/components/prompt-input.tsx`

## Changes Summary

### 1. Add Image Type (line 26, after FileAttachmentPart)
```typescript
export interface ImageAttachmentPart extends PartBase {
  type: "image"
  id: string
  path: string
  data: string
  index: number
}
```

### 2. Update ContentPart (line 28)
```typescript
export type ContentPart = TextPart | FileAttachmentPart | ImageAttachmentPart
```

### 3. Add State Variables (line ~50, inside component)
```typescript
const [uploadedImages, setUploadedImages] = createSignal<Map<number, ImageAttachmentPart>>(new Map())
const [imageCounter, setImageCounter] = createSignal(0)
const [isDragging, setIsDragging] = createSignal(false)
```

### 4. Add 3 Drag Handlers (line ~75)
```typescript
const handleDragOver = (e: DragEvent) => { /* see full guide */ }
const handleDragLeave = (e: DragEvent) => { /* see full guide */ }
const handleDrop = async (e: DragEvent) => { /* see full guide */ }
```

### 5. Update handleSubmit (line ~350)
**Key logic:** Parse text for `[image #N]`, only submit referenced images

### 6. Add to JSX (line ~450, before editor)
```tsx
<Show when={uploadedImages().size > 0}>
  <div class="flex flex-wrap p-2 border-b border-border">
    {/* Image previews */}
  </div>
</Show>
```

### 7. Update Editor Div Attributes
```tsx
onDragOver={handleDragOver}
onDragLeave={handleDragLeave}
onDrop={handleDrop}
classList={{ "ring-2 ring-primary": isDragging() }}
```

## Key Concepts

**Reference System:**
- `[image #1]` is a movable pointer
- Delete reference = discard image
- Move reference = image follows
- Only referenced images submitted

**Smart Submission:**
```typescript
// Text: "See [image #1] and [image #3]"
// Uploads: {1, 2, 3}
// Submitted: {1, 3} only ✓
```

## Full Code

See `IMAGE_UPLOAD_FINAL.md` for complete code snippets.
