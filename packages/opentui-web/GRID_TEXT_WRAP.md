# GridTextWrap Component

Added text wrapping functionality to the OpenTUI terminal grid system.

## New Component: `GridTextWrap.tsx`

A component that wraps long text across multiple rows in the terminal grid.

### Features:
- **Smart line breaking**: Breaks at spaces when possible (last 40% of line)
- **Fallback to hard break**: Breaks mid-word if no suitable space found
- **Multiple row rendering**: Each line rendered on successive rows
- **Click handling**: Only first line receives onClick handler
- **Consistent styling**: Uses GridText internally for consistent appearance

### Props:
```typescript
interface GridTextWrapProps {
  col: number        // Starting column
  row: number        // Starting row
  text: string       // Text to wrap
  maxWidth: number   // Maximum width in characters
  fg?: string        // Foreground color
  bg?: string        // Background color
  bold?: boolean     // Bold text
  onClick?: () => void // Click handler (first line only)
}
```

### Utility Function:
```typescript
calculateWrappedRows(text: string, maxWidth: number): number
```
Calculates how many rows a text will occupy when wrapped.

## Updated: `SessionsPanel.tsx`

Replaced `truncate()` function with `GridTextWrap` for session titles.

### Changes:
1. **Added imports**: `GridTextWrap`, `calculateWrappedRows`, `createMemo`
2. **Removed truncate**: No more ellipsis truncation
3. **Added row offset calculation**: Tracks cumulative row usage for proper spacing
4. **Updated rendering**: All session types now use GridTextWrap

### Session Types:
- **Child sessions**: maxWidth 35 (col 6, indented)
- **Parent sessions**: maxWidth 36 (col 4, with arrow at col 2)
- **Regular sessions**: maxWidth 37 (col 4)

### Benefits:
- Full session titles visible (no truncation)
- Proper word wrapping at spaces
- Automatic row spacing adjustment
- Maintains click functionality
- Preserves selection highlighting

## Example Usage:

```tsx
import { GridTextWrap, calculateWrappedRows } from "./GridTextWrap"

// Basic usage
<GridTextWrap
  col={4}
  row={10}
  text="Very long session title that needs to wrap across multiple lines"
  maxWidth={37}
  fg="#ffffff"
  onClick={() => handleClick()}
/>

// Calculate rows needed
const rowsUsed = calculateWrappedRows("Long text here", 37)
const nextRow = currentRow + rowsUsed
```

## Testing:

Text wrapping tested with:
- Short text (no wrapping): ✅
- Long text with spaces (smart breaking): ✅
- Text without spaces (hard breaking): ✅
- Text exactly at maxWidth: ✅

All TypeScript checks pass.
