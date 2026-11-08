# Plan Content for FigJam Boards

**When NOT to use this skill:** Do NOT read this skill for analysis, summarization, or investigation of existing board content (e.g. "summarize this board", "what themes are here?", "analyze the feedback"). This skill is exclusively for planning NEW content to be created on the board.

Do NOT use this skill for flowcharts, architecture diagrams, sequence diagrams, state diagrams, or entity relationship diagrams (ERDs). For those, use the `figma-plugin:figma-generate-diagram` skill and the `generate_diagram` tool.

Use this skill when determining **what content to include** for generated FigJam board content. Given a user's request (e.g. "make a brainstorm template", "retro board", "ice breaker", "scaffold"), produce a **sequential outline** that downstream skills can use to create sections, text, stickies, and layout.

**Must be loaded alongside the `figma-use-figjam` skill**, which provides the FigJam Plugin API references (create-section, create-sticky, create-text, position-figjam-nodes) needed to render the planned content.

## Part 1: Design Principles

### Reading direction and grouping

Left-to-right, top-to-bottom. Context on the left, evidence in the middle, proposal/asks on the right. Supporting detail and appendix below.

**Tight clustering** (60-92px) = same thought. **Loose spacing** (200-400px) = different topics. **Zone breaks** (1000px+) = different part of the board.

### Type scale

Use **Inter** exclusively. Subtitles should be 40-50% the size of their parent heading.

| Role             | Size    | Weight         |
| ---------------- | ------- | -------------- |
| Board title      | 60-96px | Bold           |
| Board subtitle   | 36-40px | Regular        |
| Section heading  | 48px    | Bold           |
| Section subtitle | 24-28px | Regular        |
| Card title       | 28-32px | Semi Bold      |
| Body text        | 20-24px | Regular        |
| Metadata         | 16px    | Regular/Medium |

### Color semantics

**White cards inside colorful containers.** Section backgrounds alternate warm/cool for rhythm: peach, lavender, soft blue, light gray.

| Signal                      | Color                             | Use                                    |
| --------------------------- | --------------------------------- | -------------------------------------- |
| Attention ("look here")     | Gold `{r:0.85, g:0.65, b:0.1}`    | Neutral urgency. Not negative.         |
| Problem / regression        | Orange `{r:0.72, g:0.38, b:0.08}` | Something trending wrong               |
| Critical / blocked          | Red `{r:0.75, g:0.18, b:0.18}`    | Something actually broken              |
| Healthy / shipped           | Green `{r:0.12, g:0.5, b:0.3}`    | Small indicators only, not backgrounds |
| Informational / in-progress | Blue `{r:0.22, g:0.4, b:0.75}`    | Neutral                                |
| Decision needed             | Pink `{r:0.7, g:0.2, b:0.45}`     | Action required                        |
| Exploration                 | Purple `{r:0.45, g:0.3, b:0.65}`  | Ideation                               |

**Key rule:** Gold = "look here." Red = "this is bad." Don't use red for attention.

### Proportion and alignment

- Size sections to fit content, not the other way around
- Center elements in rows on the same y-axis
- Center content in portrait/vertical cards
- Position badges relative to text, not section edges
- At least 12-16px breathing room between title and body

### Every board needs an entry point

Board title (60-96px) at top-left, clearly visible at overview zoom. For templates, add a meta/instructions section. For meetings, a colored agenda sticky.

---

## Part 2: Construction Rules

### Board structure

**Always wrap the entire board in one top-level white section.** This makes the board a single movable unit.

```js
const board = figma.createSection();
board.name = '';
board.resizeWithoutConstraints(estimatedW, estimatedH);
board.fills = [{ type: 'SOLID', color: {r:1, g:1, b:1} }];
// All content goes inside: board.appendChild(...)
```

**Size from content outward.** Choose card width based on the text inside it (body text reads well at 400-1000px depending on density). Derive section width from card count and card width. Derive board width from sections. Never divide a container's width to get card width. Never stretch a card to fill its parent. Sections and cards don't need to be the same width as each other unless they share a content pattern.

**For participatory zones, size to the expected activity, not the current content.** Workshop sections, feedback areas, brainstorm columns, and retro lanes exist for other people to fill. Size them to fit the expected number of contributors. Pre-seed with a few example stickies to signal the interaction pattern.

**Clear all section names** unless the section has no title text inside it.

### Spacing grid

All spacing in multiples of 4px.

```js
const spacing = {
  sectionPadding: { top: 68, right: 60, bottom: 100, left: 80 },
  elementGapH: 60, // between cards/columns
  elementGapV: 64, // between stacked elements
  siblingGapH: 92, // between sibling sections
  siblingGapV: 120, // between section rows
  contentPadding: 24, // inside cards
}
```

**Lay out inside the inset, not from one edge.** Compute usable area first (container size minus padding on all sides), then fit items within it.

### Color palette

For the canonical FigJam palettes (sticky / section / connector / shape / label), see [figjam-colors](figjam-colors.md). The palette below is a derived set of accent colors and section tints used specifically for board-content layouts (templates, retros, brainstorms) — they're not exact FigJam palette swatches.

```js
const black = { r: 0.07, g: 0.07, b: 0.07 }
const gray = { r: 0.35, g: 0.35, b: 0.35 }
const red = { r: 0.75, g: 0.18, b: 0.18 }
const orange = { r: 0.72, g: 0.38, b: 0.08 }
const green = { r: 0.12, g: 0.5, b: 0.3 }
const blue = { r: 0.22, g: 0.4, b: 0.75 }
const purple = { r: 0.45, g: 0.3, b: 0.65 }
const attention = { r: 0.85, g: 0.65, b: 0.1 } // gold
const attentionLight = { r: 1, g: 0.85, b: 0.2 } // bright gold (starburst fills)
const attentionBg = { r: 1, g: 0.96, b: 0.85 } // soft gold (card tint)

// Section backgrounds
const white = { r: 1, g: 1, b: 1 } // #FFFFFF
const lightGray = { r: 0.976, g: 0.976, b: 0.976 } // #F9F9F9
const lightGreen = { r: 0.922, g: 1, b: 0.933 } // #EBFFEE
const lightTeal = { r: 0.945, g: 0.996, b: 0.992 } // #F1FEFD
const lightBlue = { r: 0.961, g: 0.984, b: 1 } // #F5FBFF
const lightViolet = { r: 0.973, g: 0.961, b: 1 } // #F8F5FF
const lightPink = { r: 1, g: 0.941, b: 0.98 } // #FFF0FA
const lightRed = { r: 1, g: 0.961, b: 0.961 } // #FFF5F5
const lightOrange = { r: 1, g: 0.969, b: 0.941 } // #FFF7F0
const lightYellow = { r: 1, g: 0.984, b: 0.941 } // #FFFBF0
```

### API surface

**Native primitives:** `createText`, `createFrame`, `createRectangle`, `createEllipse`, `createLine`, `createStar`, `createPolygon`, `createVector`, `figma.union()` / `figma.subtract()`

**FigJam-specific:** `createSticky`, `createShapeWithText`, `createConnector`, `createSection`, `createTable`, `createCodeBlock`, `createNodeFromSvg`

**Not available:** `createComponent`, `createComponentSet`

### Choosing the right node type

| Need                      | Use                                          | Why                                                                       |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| Flowchart node with label | `createShapeWithText`                        | Built-in text centering, connector endpoints                              |
| Card                      | `createSection`                              | Native FigJam grouping with background fill, nests inside parent sections |
| Badge / pill              | `createFrame` + auto-layout + text           | Precise padding, radius, auto-centered text                               |
| Emphasis marker with text | `createFrame` container + shape + text       | Frame guarantees centering                                                |
| Emphasis marker (no text) | `createPolygon`/`createStar`/`createEllipse` | Triangle, starburst, dot                                                  |
| Top-level zone            | `createSection`                              | FigJam native grouping, zoom-to behavior                                  |
| Divider                   | `createRectangle` at 1-2px height            | Simple                                                                    |

### Sections as cards

Cards are nested sections. They give you native FigJam grouping (zoom-to behavior, movable as a unit) with a background fill, and they nest cleanly inside parent sections.

```js
const card = figma.createSection();
card.name = '';
card.resizeWithoutConstraints(width, height);
card.fills = [{ type: 'SOLID', color: white }];
// Sections don't support auto-layout — position children with absolute x/y
// inside the card, accounting for your own padding.
```

Sections nest. A board is a section that contains zone sections, which contain card sections. Use frames only for badges, pills, or other small containers that need auto-layout to center text.

### Text

Canonical recipe: load every (family, style) you'll mutate → `await` → mutate → return IDs. Inter is preloaded in most environments but every style still needs an explicit load — and any non-Inter family (e.g. `Merriweather`, `Roboto Mono`, `Figma Hand`) absolutely does. See [figma-use → gotchas.md → Canonical text-edit recipe](../../figma-use/references/gotchas.md#canonical-text-edit-recipe-font-load--await--mutate--return-ids).

```js
// Load every (family, style) you'll mutate before any createText / characters write
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });

const t = figma.createText();
t.fontName = { family: 'Inter', style: 'Bold' };
t.fontSize = 32;
t.fills = [{ type: 'SOLID', color: black }];
t.characters = 'Title';
// For body text, constrain width:
t.resize(440, 10);
t.textAutoResize = 'HEIGHT';
```

Body text max width: 440-520px. Rich text via `setRangeFontName` and `setRangeHyperlink`.

### Emphasis markers

Use sparingly. One or two per section max. They work by breaking the visual pattern at overview zoom.

**Card-level:**

- Gold border + warm tint = "pay attention" (neutral)
- Red border + red tint = "off-track" (negative status only)
- Warning triangle (`createPolygon({ pointCount: 3 })`) pinned to top-right corner
- Notification dot (`createEllipse`) with count inside

**Section-level:**

- Starburst (`createStar({ pointCount: 8, innerRadius: 0.65 })`) with gold fill and text ("NEW", "UPDATED")
- Bullseye (concentric rings with decreasing opacity)

**Centering text over shapes:** Always use a frame container. Never position text with manual x/y math.

```js
// Load font BEFORE the text.characters write — required for every font, not just Inter
await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
const container = figma.createFrame();
container.resize(56, 56); container.fills = []; container.clipsContent = false;
const shape = figma.createStar(); shape.resize(56, 56);
container.appendChild(shape); shape.x = 0; shape.y = 0;
const text = figma.createText();
text.fontName = { family: 'Inter', style: 'Bold' };
text.characters = 'NEW';
container.appendChild(text);
text.x = (56 - text.width) / 2; text.y = (56 - text.height) / 2;
```

**Flowchart emphasis:** Green Yes / Red No pills. Octagon for hard blockers. Diamond (rotated rect) for decisions.

### Tables

Style header rows with Bold weight and tinted fill. Size table width to match section width minus padding. Don't leave tables floating in whitespace.

### Stickies

For discussion, not editorial content. Color semantics: blue=discussion, yellow=question, green=positive, pink=concern, red=blocker, teal=decision, violet=ideation.

**Always lay out stickies in a grid.** Rows and columns, consistent 64px gap, aligned to the top-left of the usable inset. Stickies are 240x240 (square) or 416x240 (wide, for longer text). These sizes are fixed; stickies cannot be resized. Never stagger, overlap, or let stickies touch section edges.

---

## Part 3: Workflow

### 0. Understand the ask

What's the purpose? Who's the audience? Once or recurring? Match to an archetype if possible.

### 1. Plan the narrative

Outline beats/sections in plain text before writing code.

### 2. Build incrementally

**First call:** Create the white wrapper section at a rough estimated size (you'll resize it in the reflow pass).

Then for each sub-section:

1. Create cards and content first — size cards to fit their text
2. Create the container section sized to wrap those cards (card count × card width + gaps + padding)
3. Validate with `get_screenshot`. Fix before moving on.

### 3. Reflow pass

- `textAutoResize = 'HEIGHT'` on all text
- Resize cards to fit content
- Equalize card heights within rows where cards share a content pattern
- Resize each section to hug its children (measure rightmost/bottommost content edge + padding)
- Resize the board wrapper to hug all sections

### 4. Audit pass

- No overflow (child exceeds parent bounds)
- No overlap (consecutive text nodes collide)
- Section names cleared
- Spacing grid compliance
- Type scale compliance
- Color consistency

---

## Part 4: Archetypes

Use these when the prompt matches a known board type.

### Vision Board

3-5 narrative sections left-to-right. Optional working canvas below. Feedback capture at bottom. Mix text with stickies and screenshots.

### Exec Review / Decision Board

Linear left-to-right story. 5-8 sections alternating warm/cool tints. Pink/magenta for decisions. Appendix below.

### Area Review (Template)

Grid of identical team panels. Each team gets the same sub-section structure (discussion, KRs, project updates, references).

### Pillar Check-in / Monthly Cadence

Time x teams grid. Columns = months, rows = teams. Board grows rightward.

### Competitive Research

Freeform spatial map. Screenshot-dominant. Column sub-sections. Data tables for evidence.

### Workshop / Brainstorm

Two zones: pre-filled analysis + live brainstorm stickies. Meta section with instructions at top-left. Participatory zones should be sized for the expected activity (how many people, how many stickies per person), not the pre-filled content. Pre-seed each zone with a few example stickies to set the tone and show participants what's expected.

### Status Card Grid

Uniform cards with consistent layout. Progress bars and RAG status badges. Category labels on left edge.

### Context | Options | Decision

Three zones side-by-side: Context (lavender, constraints), Options (2-3 white cards with upside/downside, rectangle dividers), Decision (pink, recommendation).

### Vertical Metric Cards

Portrait cards (400-500px wide) with centered content. Tinted backgrounds per card.

### Top-to-Bottom Flow

Vertical flowchart. Green Yes / Red No pills on connector paths. Distinct fills per node type. `createShapeWithText` for all nodes.

---

## Anti-patterns

- Don't use stickies for editorial content. Text for narrative, stickies for discussion.
- Don't use shapes as decoration. Every shape communicates: flowchart node, data viz, or emphasis.
- Don't over-emphasize. One or two markers per section max.
- Don't use red for attention. Gold draws the eye without implying failure.
- Don't use em dashes. Periods, commas, or restructure.
- Don't build the entire board in one `use_figma` call. Work incrementally.
- Don't guess text height. Always `textAutoResize = 'HEIGHT'` and reflow.
- Don't use body text below 20px or metadata below 16px.
- Don't skip the wrapper section. Every board is one movable unit.
- Don't skip the entry point. Every board needs a visible title.
- Don't leave section names on. Clear them unless there's no title text inside.
- Don't make text-only boards. Mix text with visual evidence (screenshots, diagrams, stickies).
- Don't left-align vertical cards. Center hero numbers and text.
- Don't use green for large backgrounds. Reserve for small status indicators.
- Don't let text overlap. Reflow after setting content. This is a critical bug.
- Don't manually position text over shapes. Use a frame container for centering.
- Don't stretch cards to fill their parent. Width should serve readability.
- Don't size participatory zones to their pre-filled content. Size for expected activity.
- Don't scatter or stagger stickies. Always a grid with consistent gap.
- Don't split a bulleted list across multiple text nodes — one node per bullet. Put the whole list in a single multi-line text node (`\n`-separated) so line spacing, alignment, and reflow are handled by the text engine. Separate nodes drift, mis-space, and force you to position each one manually.
