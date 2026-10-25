# Slide Grid

The slide grid is a 2D array of `SlideNode` objects, organized by rows.

## Newly created files have an empty grid

A Slides file produced by `create_new_file` starts with **zero rows and zero slides** — `figma.getSlideGrid()` returns `[]`, not a default first slide. The page's only child is the `SLIDE_GRID` node itself (typically id `0:3`), which is empty until you create content. The first call to `figma.createSlide()` implicitly creates row 0 and inserts the new slide there; subsequent `createSlide()` calls append to the end of the last row.

```js
// On a fresh Slides file
const grid = figma.getSlideGrid();
// → []   (NOT a one-element array — there is no default slide)

const slide = figma.createSlide();   // creates row 0 + the slide in one shot
const grid2 = figma.getSlideGrid();
// → [[slide]]
```

If your script assumes at least one slide exists (e.g. to read theme tokens off it), guard for the empty case or call `createSlide()` first.

## Reading the grid

```js
const grid = figma.getSlideGrid();
// Returns: SlideNode[][]
// Example shape:
// [
//   [slide1, slide2],          // Row 0
//   [slide3, slide4, slide5],  // Row 1
//   [slide6],                  // Row 2
// ]

return grid.map((row, rowIdx) => ({
  row: rowIdx,
  slides: row.map((slide, colIdx) => ({
    id: slide.id,
    name: slide.name,
    col: colIdx,
  })),
}));
```

The inner arrays are plain `SlideNode[]` — they are NOT `SLIDE_ROW` nodes. Setting `.name` or any other property on them mutates a JS array, not the underlying section. To touch the `SLIDE_ROW` itself (e.g. to rename a section), traverse the node tree via `SLIDE_GRID.children`. See [slide-lifecycle.md — Slide sections](slide-lifecycle.md#slide-sections).

## Reordering the grid

`setSlideGrid` accepts a new 2D array. All existing slides must be present — you can change row grouping and ordering but cannot drop slides.

```js
// Move the first row to the end
const grid = figma.getSlideGrid();
const [firstRow, ...rest] = grid;
figma.setSlideGrid([...rest, firstRow]);
```

```js
// Flatten all slides into a single row
const grid = figma.getSlideGrid();
const allSlides = grid.flat();
figma.setSlideGrid([allSlides]);
```

```js
// Reverse slide order within each row
const grid = figma.getSlideGrid();
const reversed = grid.map(row => [...row].reverse());
figma.setSlideGrid(reversed);
```

```js
// Move a specific slide to a different row
const grid = figma.getSlideGrid();
const targetSlide = figma.getNodeById("SLIDE_ID");

const newGrid = grid.map(row => row.filter(s => s.id !== targetSlide.id));
// Add to the beginning of row 0
newGrid[0] = [targetSlide, ...newGrid[0]];
// Remove empty rows
const cleanGrid = newGrid.filter(row => row.length > 0);
figma.setSlideGrid(cleanGrid);
```

## Notes

- `getSlideGrid` / `setSlideGrid` are marked deprecated in favor of `getCanvasGrid` / `setCanvasGrid`, but both work in Slides.
- All slides from the current grid must be passed back to `setSlideGrid` — you can reorganize freely but cannot omit slides.
