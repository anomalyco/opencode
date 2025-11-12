# Context Chips - Final Styling

## Visual Design

### Chip Appearance
- **Style**: Tool badge style (like `BASH`, `READ` badges)
- **Layout**: Horizontal wrapping with gap between chips
- **Label Format**: ` UPPERCASE ` (spaces on each end)
- **Font**: Berkeley Mono, monospace, 16px

### Deselected State (Default)
```
┌─────────────┐
│  REACT      │  ← Dark grey background (#3a3a3a)
└─────────────┘  ← Black text (#000000)
```
- Background: `#3a3a3a` (dark grey)
- Text: `#000000` (black)
- Font weight: normal

### Hover State (Deselected)
```
┌─────────────┐
│  REACT      │  ← Lighter grey background (#4a4a4a)
└─────────────┘  ← Black text (#000000)
```
- Background: `#4a4a4a` (lighter grey)
- Text: `#000000` (black)
- Font weight: normal

### Selected State
```
┌─────────────┐
│  REACT      │  ← Type-specific color background
└─────────────┘  ← Black text (#000000), BOLD
```
- Background: Type-specific color (cyan for subjects, blue for files, etc.)
- Text: `#000000` (black)
- Font weight: **bold**

## Type Colors (When Selected)

| Type       | Color    | Hex       | Example      |
|------------|----------|-----------|--------------|
| Subject    | Cyan     | `#56b6c2` | REACT        |
| File       | Blue     | `#61afef` | APP.TSX      |
| Website    | Green    | `#98c379` | SOLIDJS DOCS |
| Protocol   | Purple   | `#c678dd` | REST API     |
| Article    | Yellow   | `#e5c07b` | CONTEXT PATTERNS |
| Custom     | White    | `#ffffff` | (user added) |

## Interaction States

### State Transitions
1. **Default (Deselected)**
   - Dark grey background
   - Black text
   - Normal weight

2. **Hover (Deselected)**
   - Lighter grey background
   - Black text
   - Normal weight

3. **Click → Selected**
   - Type-color background
   - Black text
   - **Bold** weight

4. **Click Again → Deselected**
   - Back to dark grey background
   - Black text
   - Normal weight

## Layout

```
[Select All]  [Deselect All]
[Add Custom]

 REACT   TYPESCRIPT   APP.TSX   MESSAGESPANEL.TSX 
 SOLIDJS DOCS   REST API   CONTEXT PATTERNS 
```

- Horizontal flow with wrapping
- 0.5ch gap between chips
- Fits within sidebar width
- Wraps to new line when needed

## Action Buttons
- `[Select All]` - White text (#ffffff)
- `[Deselect All]` - White text (#ffffff)
- `[Add Custom]` - White text (#ffffff)

## Example Visual States

### All Deselected
```
 REACT   TYPESCRIPT   APP.TSX   MESSAGESPANEL.TSX 
 SOLIDJS DOCS   REST API   CONTEXT PATTERNS 
```
All chips: dark grey bg, black text

### Some Selected (bold = selected)
```
 **REACT**   TYPESCRIPT   **APP.TSX**   MESSAGESPANEL.TSX 
 SOLIDJS DOCS   **REST API**   CONTEXT PATTERNS 
```
- REACT: cyan bg, black text, bold
- APP.TSX: blue bg, black text, bold
- REST API: purple bg, black text, bold
- Others: dark grey bg, black text, normal

## Key Design Principle

**High Contrast Selection**: 
- Deselected chips blend into dark background (grey on black text)
- Selected chips POP with bright colors + bold text
- Makes selection state immediately obvious
- Black text on all states ensures readability

## Code Implementation

```typescript
// Deselected
background: "#3a3a3a"  // dark grey
color: "#000000"       // black
font-weight: "normal"

// Selected
background: typeColor  // cyan/blue/green/purple/yellow/white
color: "#000000"       // black
font-weight: "bold"
```

## Transition
- Smooth 0.15s ease transition for all property changes
- Gives polished feel when clicking/hovering
