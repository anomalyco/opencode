# MessagesPanel Testing Guide

## What to Test

### 1. Messages Scrollable ✅
**How to test:**
- Add many messages (15+)
- Verify scrollbar appears
- Scroll up and down smoothly
- New messages auto-scroll to bottom

**Expected behavior:**
- Smooth GPU-accelerated scrolling
- Messages scroll independently of prompt
- Auto-scrolls to latest message

### 2. Prompt at Bottom, Always Visible ✅
**How to test:**
- Send multiple messages
- Scroll messages up
- Check prompt position

**Expected behavior:**
- Prompt stays fixed at bottom
- Always visible (never scrolls away)
- 4.5em height normal, 12em when expanded

### 3. Typing Works ✅
**How to test:**
- Click in prompt area
- Type text
- Check cursor blinks
- Press Tab to expand options
- Press Escape to collapse

**Expected behavior:**
- Text appears as typed
- Orange cursor blinks at end
- Tab/Escape toggles options
- Enter sends message
- Shift+Enter adds newline

### 4. Resizing Viewport Updates Layout Smoothly ✅
**How to test:**
- Drag left divider (sessions panel)
- Drag right divider (sidebar panel)
- Resize browser window

**Expected behavior:**
- Messages panel width adjusts immediately
- Text reflows to new width
- No layout jumps or glitches
- Smooth resize with GPU acceleration

## Test Scenarios

### Scenario 1: Full Conversation Flow
1. Type message in prompt
2. Press Enter to send
3. See message appear in scrollable area
4. Verify prompt stays at bottom
5. Auto-scrolls to show new message

### Scenario 2: Panel Resize
1. Messages visible in panel
2. Drag divider to make panel narrower
3. Verify text truncates properly
4. Drag divider to make panel wider
5. Verify text expands to use space

### Scenario 3: Long Conversation
1. Send 20+ messages
2. Verify scrollbar appears
3. Scroll to top
4. Send new message
5. Verify auto-scroll to bottom

### Scenario 4: Options Toggle
1. Type in prompt
2. Press Tab (options expand)
3. Verify messages area shrinks by 7.5em
4. Scroll still works
5. Press Escape (options collapse)
6. Verify messages area expands

## Performance Checks

- **Smooth scrolling**: No jank, uses GPU
- **Instant resize**: Width changes immediate
- **No layout thrashing**: Single reflow on resize
- **Cursor animation**: Blinks smoothly at 500ms

## Key CSS Indicators

Look for these in DevTools:
```css
.terminal-scrollbar {
  transform: translateZ(0);        /* GPU layer */
  will-change: scroll-position;    /* Optimization */
  scroll-behavior: smooth;         /* Smooth scroll */
}
```

## Debug Tips

If something doesn't work:

1. **Width not updating?**
   - Check props.width is changing in TerminalLayout
   - Verify panelWidth() is called as function
   - Check GridPanel receives new width

2. **Scroll not working?**
   - Check overflow-y: auto on container
   - Verify height calculation (100% - prompt height)
   - Check for conflicting CSS

3. **Prompt not visible?**
   - Verify position: absolute, bottom: 0
   - Check z-index stacking
   - Verify height values (4.5em/12em)

4. **Performance issues?**
   - Check GPU acceleration (translateZ)
   - Verify requestAnimationFrame usage
   - Look for excessive re-renders
