# MessagesPanel: Before vs After

## Key Differences

### Width Handling
**BEFORE:**
```tsx
const panelWidth = props.width || 74  // ❌ Static value, breaks reactivity
```

**AFTER:**
```tsx
const panelWidth = () => props.width || 74  // ✅ Reactive getter
```

### Usage
**BEFORE:**
```tsx
<GridText text={line.slice(0, panelWidth - 4)} />  // ❌ Uses stale value
<GridPanel width={panelWidth} />                    // ❌ Doesn't update
```

**AFTER:**
```tsx
<GridText text={line.slice(0, panelWidth() - 4)} />  // ✅ Always current
<GridPanel width={panelWidth()} />                   // ✅ Reactive updates
```

### Scroll Container
**BEFORE:**
```tsx
<div class="terminal-scrollbar">  // ❌ No ref, no auto-scroll
  {renderMessages()}
</div>
```

**AFTER:**
```tsx
<div 
  ref={setScrollContainer}  // ✅ Ref for auto-scroll
  class="terminal-scrollbar"
  style={{
    // ... existing styles ...
    transform: "translateZ(0)",              // ✅ GPU acceleration
    "will-change": "scroll-position",        // ✅ Optimization hint
    "scroll-behavior": "smooth",             // ✅ Smooth scrolling
  }}
>
  {renderMessages()}
</div>
```

### Auto-Scroll Effect
**BEFORE:**
```tsx
// ❌ No auto-scroll logic
```

**AFTER:**
```tsx
// ✅ Auto-scroll to bottom on new messages
createEffect(() => {
  const container = scrollContainer()
  if (container && props.messages.length > 0) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
  }
})
```

## What This Fixes

1. **Dynamic Width**: Panel now resizes when dividers move
2. **Auto-Scroll**: Messages automatically scroll to bottom when new messages arrive
3. **Performance**: GPU-accelerated smooth scrolling
4. **Responsiveness**: Width changes trigger proper re-renders
5. **Layout Stability**: Prompt always stays at bottom, messages scroll independently

## SolidJS Reactivity Lesson

In SolidJS, **const values break reactivity**:
```tsx
const value = props.something  // ❌ Takes snapshot, never updates
const value = () => props.something  // ✅ Creates reactive getter
```

Always use **function wrappers** for reactive values derived from props!
