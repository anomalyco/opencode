# Slide-Specific Properties

## isSkippedSlide

Read and set whether a slide is skipped during presentation playback.

```js
const slide = figma.getNodeById("SLIDE_ID");

// Read
const isSkipped = slide.isSkippedSlide;

// Set — skip a slide
slide.isSkippedSlide = true;

// Unskip
slide.isSkippedSlide = false;
```

## focusedSlide (Page property)

Get or set the currently focused slide on a page. This is a property of `PageNode`, not `SlideNode`.

```js
// Get the focused slide
const focused = figma.currentPage.focusedSlide;
if (focused) {
  return { focusedSlideId: focused.id, name: focused.name };
}

// Set the focused slide
const slide = figma.getNodeById("SLIDE_ID");
figma.currentPage.focusedSlide = slide;
```

## focusedNode (Page property)

Get or set the currently focused node on a page. Works with any focusable node.

```js
const focused = figma.currentPage.focusedNode;
if (focused) {
  return { id: focused.id, type: focused.type, name: focused.name };
}
```

## speakerNotes

Read and set the presenter/speaker notes for a slide. The value is a **markdown string**.

```js
const slide = figma.getNodeById("SLIDE_ID");

// Read speaker notes
const notes = slide.speakerNotes;
// Returns "" if no notes are set

// Set speaker notes (plain text)
slide.speakerNotes = "Remember to mention the Q4 goals.";

// Set speaker notes with list formatting
slide.speakerNotes = "Key points:\n- Revenue grew 20%\n- User base doubled\n- NPS at all-time high";

// Set speaker notes with numbered list
slide.speakerNotes = "Agenda:\n1. Introduction\n2. Demo\n3. Q&A";

// Clear speaker notes
slide.speakerNotes = "";
```

### Supported formatting

The speaker notes editor in Figma Slides supports a subset of markdown formatting:

- **Unordered lists**: `- item` or `* item`
- **Ordered lists**: `1. item`, `2. item`
- **Bold**: `**text**`
- **Italic**: `*text*`
- **Bold + italic**: `***text***`
- **Strikethrough**: `~~text~~`

The following markdown is **not supported** and will be stored as raw text (the markdown syntax characters will appear literally in the notes):
- Headings (`# text`, `## text`)
- Code blocks (`` `code` `` or ` ``` `)
- Links (`[text](url)`)
- Underline

## InteractiveSlideElementNode

Interactive elements embedded in slides (polls, embeds, etc.). These are read-only — you cannot create them via the Plugin API, but you can detect and inspect them.

```js
const slide = figma.getNodeById("SLIDE_ID");
const interactive = slide.findAllWithCriteria({ types: ["INTERACTIVE_SLIDE_ELEMENT"] });
return interactive.map(n => ({
  id: n.id,
  type: n.interactiveSlideElementType,
}));
```

Possible `interactiveSlideElementType` values: `'POLL'`, `'EMBED'`, `'FACEPILE'`, `'ALIGNMENT'`, `'YOUTUBE'`.

## Known Limitations

- **`getSlideTransition()` / `setSlideTransition()`**: These methods are declared in the type definitions but throw "not implemented" at runtime. Do not use them.
- **`SlideGridNode.clone()`**: Throws at runtime — you cannot copy the slide grid.
- **Slide themes**: `slideThemeId` is available as a read-only property on slide nodes for identifying which theme is applied, but theme manipulation APIs are limited.
- **`figma.createTable()` and `figma.createGif()`**: These FigJam node types (TABLE, MEDIA) are currently blocked in Slides mode by the Plugin API, even though the Slides editor supports tables and media. To work with tables and media in Slides, use the editor UI directly. This is a pre-existing Plugin API limitation, not specific to `use_figma`.

<!-- TODO(dschwartz): Before production launch, fix NODE_TYPES_BLOCKED_IN_SLIDES in
     share/plugin-api/src/api/constants.ts to unblock TABLE and MEDIA for Slides
     (same pattern as the SYMBOL unblock for MCP/assistant). Remove this limitation
     note once fixed. -->
