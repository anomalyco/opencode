# Image Upload Feature - Implementation Guide

## Overview
Add drag-and-drop image upload to the PromptInput component with automatic reference replacement `[image #1]`, `[image #2]`, etc.

## Changes Required

### File: `src/components/prompt-input.tsx`

#### 1. Add ImageAttachmentPart Type (after line 25)

```typescript
export interface ImageAttachmentPart extends PartBase {
  type: "image"
  path: string      // original filename
  data: string      // base64 encoded image data
  index: number     // for display as [image #N]
}
```

#### 2. Update ContentPart Type (line 28)

```typescript
export type ContentPart = TextPart | FileAttachmentPart | ImageAttachmentPart
```

#### 3. Add State for Images (after line 48, inside component)

```typescript
const [uploadedImages, setUploadedImages] = createSignal<ImageAttachmentPart[]>([])
const [isDragging, setIsDragging] = createSignal(false)
```

#### 4. Add Drag/Drop Handlers (after speech recognition setup, ~line 75)

```typescript
const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  setIsDragging(true)
}

const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  setIsDragging(false)
}

const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  setIsDragging(false)
  
  const files = Array.from(e.dataTransfer?.files || [])
  const imageFiles = files.filter(f => f.type.startsWith('image/'))
  
  for (const file of imageFiles) {
    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = evt.target?.result as string
      const currentImages = uploadedImages()
      const index = currentImages.length + 1
      
      const imagePart: ImageAttachmentPart = {
        type: "image",
        path: file.name,
        data,
        index,
        content: `[image #${index}]`,
        start: 0,
        end: 0
      }
      
      setUploadedImages([...currentImages, imagePart])
      addPart({ type: "text", content: `[image #${index}] `, start: 0, end: 0 })
    }
    reader.readAsDataURL(file)
  }
}
```

#### 5. Add Image Preview Component (before main component, ~line 30)

```typescript
const ImagePreview: Component<{ image: ImageAttachmentPart, onRemove: () => void }> = (props) => {
  return (
    <div class="inline-flex items-center gap-2 px-2 py-1 bg-background-element rounded border border-border mr-2 mb-2">
      <img 
        src={props.image.data} 
        alt={props.image.path}
        class="w-8 h-8 object-cover rounded"
      />
      <span class="text-xs text-text">[image #{props.image.index}]</span>
      <button
        onClick={props.onRemove}
        class="text-text-muted hover:text-text"
      >
        <Icon name="close" class="size-3" />
      </button>
    </div>
  )
}
```

#### 6. Update Editor Div Attributes (find the main contenteditable div, ~line 450)

Add these attributes:
```typescript
onDragOver={handleDragOver}
onDragLeave={handleDragLeave}
onDrop={handleDrop}
classList={{ 
  /* existing classes */
  "ring-2 ring-primary": isDragging()
}}
```

#### 7. Add Image Preview Display (before editor div)

```tsx
<Show when={uploadedImages().length > 0}>
  <div class="flex flex-wrap p-2 border-b border-border">
    <For each={uploadedImages()}>
      {(image, idx) => (
        <ImagePreview 
          image={image} 
          onRemove={() => {
            setUploadedImages(prev => prev.filter((_, i) => i !== idx()))
          }} 
        />
      )}
    </For>
  </div>
</Show>
```

#### 8. Update Submit Handler (find handleSubmit, ~line 350)

Include uploaded images in submission:
```typescript
const handleSubmit = () => {
  if (isEmpty()) return
  
  const parts = parseFromDOM()
  const images = uploadedImages()
  
  // Merge images into parts
  const allParts = [...parts, ...images]
  
  props.onSubmit(allParts)
  
  // Clear everything
  editorRef.innerHTML = ""
  setUploadedImages([])
  setStore("contentParts", defaultParts)
}
```

#### 9. Update isEqual Function (line ~458)

```typescript
function isEqual(arrA: ContentPart[], arrB: ContentPart[]): boolean {
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i++) {
    const partA = arrA[i]
    const partB = arrB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file" && partA.path !== (partB as FileAttachmentPart).path) {
      return false
    }
    if (partA.type === "image" && partA.data !== (partB as ImageAttachmentPart).data) {
      return false
    }
  }
  return true
}
```

## User Experience

### How It Works:
1. User drags image file(s) into the input area
2. Input highlights with blue ring during drag
3. On drop:
   - Images are read as base64 data
   - Stored in state
   - Text `[image #1]` inserted at cursor
   - Preview thumbnail shown above input
4. User can remove images by clicking X on preview
5. When submitted, images are included in ContentPart array

### Visual Feedback:
- Blue ring border during drag over
- Thumbnail previews with [image #N] labels
- Remove button (X) on each preview
- Images maintain order: #1, #2, #3, etc.

## API Integration

The uploaded images will be included in the `ContentPart[]` array passed to `onSubmit`:

```typescript
{
  type: "image",
  path: "screenshot.png",
  data: "data:image/png;base64,iVBORw0KGgo...",
  index: 1,
  content: "[image #1]",
  start: 0,
  end: 0
}
```

The backend can then:
1. Extract base64 data
2. Save to temporary storage
3. Pass to LLM vision API
4. Associate with message

## Testing

1. Drag a PNG/JPG file into the input
2. Verify `[image #1]` appears in text
3. Verify thumbnail preview shows
4. Drag another image
5. Verify `[image #2]` appears
6. Click X to remove an image
7. Submit and verify images are in parts array

## Future Enhancements

- [ ] Support for copy/paste images
- [ ] Image compression before upload
- [ ] Progress indicator for large images
- [ ] Preview on hover
- [ ] Edit/crop images inline
- [ ] Support for non-image files with [file #N]
