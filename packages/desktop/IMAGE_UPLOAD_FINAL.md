# Image Upload with Reference Tracking - Final Implementation

## Overview
Images can be dragged into the input, creating `[image #N]` references that can be moved around. Only images with references in the final text are submitted. Deleting the reference discards the image.

## Key Features

### 1. **Reference-Based System**
- Each image gets a unique ID and display number
- Text contains movable `[image #1]`, `[image #2]` references  
- References can be placed anywhere: before, after, between text
- Only referenced images are submitted

### 2. **Smart Submission**
- Parse text for `[image #N]` patterns
- Extract referenced image numbers
- Only include those images in submission
- Deleted references = discarded images

### 3. **Context Optimization Ready**
- Images have unique IDs for tracking
- Can be targeted for compression/optimization later
- Separate from text content for processing

## Implementation

### Step 1: Update Types (lines 12-40)

```typescript
export interface ImageAttachmentPart extends PartBase {
  type: "image"
  id: string        // unique ID: img_timestamp_counter
  path: string      // original filename  
  data: string      // base64 data
  index: number     // display as [image #N]
}

export type ContentPart = TextPart | FileAttachmentPart | ImageAttachmentPart
```

### Step 2: Add Image Preview Component (before PromptInput, line 36)

```typescript
const ImagePreview: Component<{ image: ImageAttachmentPart, onRemove: () => void }> = (props) => {
  return (
    <div class="inline-flex items-center gap-2 px-2 py-1 bg-background-element rounded border border-border mr-2 mb-2">
      <img 
        src={props.image.data} 
        alt={props.image.path}
        class="w-10 h-10 object-cover rounded"
      />
      <span class="text-xs text-text font-mono">[image #{props.image.index}]</span>
      <span class="text-xs text-text-muted truncate max-w-24">{props.image.path}</span>
      <button
        onClick={props.onRemove}
        class="text-text-muted hover:text-error transition-colors"
      >
        <Icon name="close" class="size-3" />
      </button>
    </div>
  )
}
```

### Step 3: Add State (after line 48 in PromptInput)

```typescript
// Image upload state
const [uploadedImages, setUploadedImages] = createSignal<Map<number, ImageAttachmentPart>>(new Map())
const [imageCounter, setImageCounter] = createSignal(0)
const [isDragging, setIsDragging] = createSignal(false)

// Generate unique image ID
const generateImageId = () => {
  const count = imageCounter() + 1
  setImageCounter(count)
  return `img_${Date.now()}_${count}`
}
```

### Step 4: Add Drag/Drop Handlers (after speech recognition, ~line 75)

```typescript
// Drag and drop handlers
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
      const index = imageCounter() + 1
      const id = generateImageId()
      
      const imagePart: ImageAttachmentPart = {
        type: "image",
        id,
        path: file.name,
        data,
        index,
        content: `[image #${index}]`,
        start: 0,
        end: 0
      }
      
      setUploadedImages(prev => new Map(prev).set(index, imagePart))
      addPart({ type: "text", content: `[image #${index}] `, start: 0, end: 0 })
    }
    reader.readAsDataURL(file)
  }
}

const removeImage = (index: number) => {
  setUploadedImages(prev => {
    const newMap = new Map(prev)
    newMap.delete(index)
    return newMap
  })
}
```

### Step 5: Update Submit Handler (find handleSubmit, ~line 350)

Replace with:
```typescript
const handleSubmit = () => {
  if (isEmpty()) return
  
  const parts = parseFromDOM()
  const images = uploadedImages()
  
  // Extract all [image #N] references from the text
  const textContent = parts.map(p => p.content).join(' ')
  const imageRefs = textContent.match(/\[image #(\d+)\]/g) || []
  const referencedIndexes = new Set(
    imageRefs.map(ref => parseInt(ref.match(/\d+/)?.[0] || '0'))
  )
  
  // Only include images that are actually referenced in the text
  const referencedImages: ImageAttachmentPart[] = []
  images.forEach((image, index) => {
    if (referencedIndexes.has(index)) {
      referencedImages.push(image)
    }
  })
  
  // Combine text parts with referenced images
  const allParts = [...parts, ...referencedImages]
  
  props.onSubmit(allParts)
  
  // Clear everything
  editorRef.innerHTML = ""
  setUploadedImages(new Map())
  setImageCounter(0)
  setStore("contentParts", defaultParts)
}
```

### Step 6: Add Image Previews to JSX (before editor div, ~line 450)

```tsx
{/* Image Previews */}
<Show when={uploadedImages().size > 0}>
  <div class="flex flex-wrap p-2 border-b border-border bg-background-weak">
    <For each={Array.from(uploadedImages().values())}>
      {(image) => (
        <ImagePreview 
          image={image} 
          onRemove={() => removeImage(image.index)} 
        />
      )}
    </For>
  </div>
</Show>
```

### Step 7: Update Editor Div (find contenteditable div, ~line 460)

Add attributes:
```tsx
<div
  ref={editorRef}
  contenteditable
  onDragOver={handleDragOver}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop}
  classList={{
    /* existing classes */
    "ring-2 ring-primary": isDragging(),
    "ring-offset-2": isDragging()
  }}
  /* ... rest of attributes */
>
```

### Step 8: Update isEqual (line ~458)

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

## User Experience Flow

### Adding Images:
1. Drag image file into input
2. Input highlights with blue ring
3. On drop:
   - Image loaded as base64
   - Assigned unique ID and number
   - `[image #1]` inserted in text
   - Thumbnail preview shown above input

### Moving References:
```
Before: "Check this out [image #1]"
After:  "[image #1] Look at this image"
Result: Same image, different position ✓
```

### Deleting References:
```
Before: "See [image #1] and [image #2]"
Delete: Remove "[image #1]"
Submit: Only image #2 is included ✓
```

### Multiple Images:
```
"Look at [image #1] and then [image #2] and finally [image #3]"
- All 3 images submitted in order
- Can reorder references freely
- Each maintains its identity
```

## Data Structure

```typescript
// Uploaded images stored as Map<number, ImageAttachmentPart>
uploadedImages = {
  1: { type: "image", id: "img_1234_1", data: "...", index: 1 },
  2: { type: "image", id: "img_1234_2", data: "...", index: 2 },
  3: { type: "image", id: "img_1234_3", data: "...", index: 3 }
}

// Text contains references
"Check [image #1] and [image #3]"

// Submission only includes #1 and #3
// Image #2 is discarded (no reference)
```

## Future Optimization Hooks

### Context Optimization:
```typescript
// Before sending to LLM, can:
1. Compress images based on model limits
2. Resize large images
3. Convert to optimal format
4. Track which images were used in response
5. Cache frequently referenced images
```

### Smart Reference Handling:
```typescript
// Can detect:
- Unused images (no [image #N] in text)
- Duplicate references ([image #1] appears twice)
- Out-of-order references ([image #3] before [image #1])
- Missing images ([image #5] but only 3 uploaded)
```

## Testing Checklist

- [ ] Drag single image - verify `[image #1]` appears
- [ ] Drag multiple images - verify sequential numbering
- [ ] Move `[image #1]` to end of text - verify still works
- [ ] Delete `[image #1]` reference - verify not submitted
- [ ] Keep `[image #1]`, delete `[image #2]` - verify #1 submitted
- [ ] Submit with no images - verify works normally
- [ ] Submit with images but no references - verify no images sent
- [ ] Click X on preview - verify image removed
- [ ] Drag non-image file - verify ignored

## Notes

- Images stored as base64 in browser memory
- No server upload until message submission
- Large images may impact performance
- Consider size limits for production
- Could add compression before base64 encoding
