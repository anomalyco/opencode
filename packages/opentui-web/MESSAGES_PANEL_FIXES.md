# MessagesPanel Viewport Resize Fixes

## Changes Made

### 1. **Added Reactive Width/Column Handling**
- Changed `const startCol = props.col || 44` to `const startCol = () => props.col || 44`
- Changed `const panelWidth = props.width || 74` to `const panelWidth = () => props.width || 74`
- Updated all references to call these as functions: `panelWidth()` instead of `panelWidth`
- This ensures the component responds to width changes when dividers move

### 2. **Added Auto-Scroll on New Messages**
- Created scroll container ref with `const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement>()`
- Added `createEffect()` that scrolls to bottom when messages update
- Uses `requestAnimationFrame()` for smooth, GPU-accelerated scrolling

### 3. **Enhanced GPU Acceleration**
- Added `transform: "translateZ(0)"` to scroll container
- Added `will-change: "scroll-position"` for scroll optimization
- Added `scroll-behavior: "smooth"` for smooth scrolling animations

### 4. **Maintained Proper Layout**
- Messages area: `position: absolute, top: 0, bottom: 4.5em/12em`
- Bottom spacing adjusts based on prompt expansion state
- TerminalInput: `position: absolute, bottom: 0` (already in TerminalInput.tsx)
- Width is now reactive and updates when panel dividers move

## How It Works

### Width Reactivity
```tsx
// Reactive getters maintain connection to props
const panelWidth = () => props.width || 74

// Used in JSX - recalculates when props.width changes
<GridPanel width={panelWidth()} />
```

### Scroll Management
```tsx
createEffect(() => {
  const container = scrollContainer()
  if (container && props.messages.length > 0) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
  }
})
```

### Layout Structure
```
┌─────────────────────────────────┐
│ Scrollable Messages Area        │
│ (height: calc to prompt height) │
│ - Auto-scrolls to bottom        │
│ - GPU accelerated               │
│ - Smooth scroll behavior        │
├─────────────────────────────────┤
│ Terminal Input (Fixed Bottom)   │
│ - 4.5em normal / 12em expanded  │
│ - position: absolute, bottom: 0 │
└─────────────────────────────────┘
```

## Performance Optimizations

1. **GPU Acceleration**: `transform: translateZ(0)` creates GPU layer
2. **Will-change**: Browser pre-optimizes scroll changes
3. **RequestAnimationFrame**: Smooth scroll timing
4. **Reactive Width**: Only re-renders when width actually changes

## Testing Checklist

- [x] Messages scroll independently
- [x] Prompt stays fixed at bottom
- [x] Width adjusts when panel dividers move
- [x] Smooth GPU-accelerated rendering
- [x] Input text visible and cursor blinking
- [x] Auto-scroll to bottom on new messages
- [x] Viewport resize updates layout smoothly
