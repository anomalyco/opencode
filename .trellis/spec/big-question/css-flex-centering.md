# Visual vs Mathematical Centering in Flex Layouts

> **Severity**: P2 - UI appears misaligned

## Problem

In a page with a header, content that should be "centered" appears too low:

```
+---------------------------+
|         Header            |
+---------------------------+
|                           |
|                           |
|                           |
|    [Centered Content]     |  <-- Visually too low!
|                           |
|                           |
+---------------------------+
```

The content is mathematically centered in the available space, but users perceive it as off-center.

## Typical Layout

```tsx
<div className="h-screen flex flex-col">
  <header className="h-16">Header</header>
  <main className="flex-1 flex items-center justify-center">
    <EmptyState /> {/* Centered in remaining space, not viewport */}
  </main>
</div>
```

## The Math vs Visual Problem

```
Viewport height: 800px
Header height:   64px
Remaining space: 736px

Mathematical center of remaining space:
  64 + (736 / 2) = 432px from top

Visual center of viewport:
  800 / 2 = 400px from top

Difference: Content appears 32px too low
```

With more header elements (page title, buttons, etc.), this offset grows.

## Initial Attempts (Failed)

### Attempt 1: min-height Calculations

```tsx
<main className="min-h-[calc(100vh-280px)] flex items-center justify-center">
```

**Why it fails**: Hard to calculate exact offsets. Different pages have different headers. Increasing min-height actually pushes center point LOWER.

## Solution: Negative Margin Offset

Apply a negative margin to shift centered content upward:

```tsx
<main className="flex-1 flex items-center justify-center">
  <div className="-mt-24">
    <EmptyState />
  </div>
</main>
```

### Offset Guidelines

| Page Type         | Offset   | Reason                    |
| ----------------- | -------- | ------------------------- |
| Simple header     | `-mt-16` | Small visual weight above |
| Header + subtitle | `-mt-24` | Medium visual weight      |
| Header + actions  | `-mt-32` | Large visual weight       |

## Why This Works

1. **Keeps flex centering intact** - Container still centers normally
2. **Applies visual correction** - Negative margin shifts content up
3. **Simple and predictable** - Easy to tune per page
4. **No complex calculations** - Works across different viewport sizes

## Complete Example

```tsx
function EmptyPage() {
  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <Button>New Document</Button>
      </div>

      {/* Empty state - visually centered */}
      <div className="flex-1 flex items-center justify-center">
        <div className="-mt-24">
          <EmptyState
            icon={<FileIcon />}
            title="No documents yet"
            description="Create your first document"
          />
        </div>
      </div>
    </div>
  );
}
```

## Key Insight

**Visual centering is what users expect, not mathematical centering.**

When a header takes up space at the top:

- Mathematical center is in the middle of remaining space
- Visual center is in the middle of the entire visible area
- Users perceive mathematical centering as "too low"

**The fix isn't about calculating heights** - it's about applying a visual offset to already-centered content.

## Alternative Approaches

### CSS Grid with Offset

```css
.container {
  display: grid;
  place-items: center;
  padding-bottom: 64px; /* Compensate for header */
}
```

### Transform Translate

```tsx
<div className="flex-1 flex items-center justify-center">
  <div className="transform -translate-y-12">
    <EmptyState />
  </div>
</div>
```

### Custom Centering

```css
.visual-center {
  position: absolute;
  top: 45%; /* Slightly above true center */
  left: 50%;
  transform: translate(-50%, -50%);
}
```

## When to Apply

- Empty states in pages with headers
- Loading spinners in content areas
- Centered modals/dialogs
- Any content that should "feel" centered to users

## Testing

Visual centering is subjective. Test by:

1. Taking a screenshot
2. Drawing horizontal line at viewport center
3. Content should be close to or slightly above this line
4. Get feedback from non-developers
