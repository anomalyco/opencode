# Mobile Touch Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize OpenCode App for mobile/touch devices while preserving desktop experience.

**Architecture:** Use CSS media queries and `createMediaQuery` for device detection. Implement touch-specific interactions (long-press, selection toolbar) alongside existing hover interactions. Keep changes isolated to avoid affecting desktop.

**Tech Stack:** SolidJS, Tailwind CSS, @solid-primitives/media

---

## File Structure

```
packages/app/src/
├── components/
│   ├── session/
│   │   ├── session-header.tsx        # MODIFY: Add overflow menu
│   │   └── toolbar-overflow-menu.tsx # CREATE: New overflow menu component
│   └── file-tree.tsx                 # MODIFY: Add long-press context menu
├── pages/session/
│   ├── session.tsx                   # MODIFY: Panel fullscreen on mobile
│   ├── session-side-panel.tsx        # MODIFY: Mobile layout adaptation
│   └── file-tabs.tsx                 # MODIFY: Markdown render toggle
├── context/
│   └── layout.tsx                    # MODIFY: Mobile panel state
└── hooks/
    └── use-long-press.ts             # CREATE: Long-press detection hook

packages/ui/src/
└── components/
    └── line-comment-annotations.tsx  # MODIFY: Touch selection support
```

---

## Task 1: Toolbar Overflow Menu

**Files:**

- Create: `packages/app/src/components/session/toolbar-overflow-menu.tsx`
- Modify: `packages/app/src/components/session/session-header.tsx`
- Test: `packages/app/src/components/session/toolbar-overflow-menu.test.ts`

### Step 1.1: Create overflow menu component

- [ ] **Create the toolbar overflow menu component**

Create file: `packages/app/src/components/session/toolbar-overflow-menu.tsx`

```tsx
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { createMediaQuery } from "@solid-primitives/media"
import { For, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export type OverflowItem = {
  id: string
  label: string
  icon: string
  onClick: () => void
  active?: boolean
  visible: boolean // true = visible in toolbar, false = hidden (should show in overflow)
}

export function ToolbarOverflowMenu(props: { items: OverflowItem[] }) {
  const language = useLanguage()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  // Items that are hidden from toolbar and should appear in overflow
  const hiddenItems = () => props.items.filter((item) => !item.visible)

  // Only show overflow menu if there are hidden items
  const hasOverflow = () => hiddenItems().length > 0

  return (
    <Show when={hasOverflow()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
          aria-label={language.t("common.moreOptions")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <For each={hiddenItems()}>
              {(item) => (
                <DropdownMenu.Item onSelect={item.onClick}>
                  <Icon name={item.icon} size="small" class="text-icon-weak" />
                  <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
```

- [ ] **Commit Step 1.1**

```bash
git add packages/app/src/components/session/toolbar-overflow-menu.tsx
git commit -m "feat(app): add toolbar overflow menu component"
```

### Step 1.2: Integrate overflow menu into session header

- [ ] **Modify session-header.tsx to use overflow menu**

Modify file: `packages/app/src/components/session/session-header.tsx`

Add import at top:

```tsx
import { ToolbarOverflowMenu, type OverflowItem } from "./toolbar-overflow-menu"
```

Add media query detection (after line 266):

```tsx
const isMd = createMediaQuery("(min-width: 768px)")
const isXl = createMediaQuery("(min-width: 1280px)")
```

Replace the toolbar section (lines 417-479) with:

```tsx
<div class="flex items-center gap-1">
  <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
    <StatusPopover />
  </Tooltip>
  <TooltipKeybind title={language.t("command.terminal.toggle")} keybind={command.keybind("terminal.toggle")}>
    <Button
      variant="ghost"
      class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
      onClick={toggleTerminal}
      aria-label={language.t("command.terminal.toggle")}
      aria-expanded={view().terminal.opened()}
      aria-controls="terminal-panel"
    >
      <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
    </Button>
  </TooltipKeybind>

  {/* Review toggle - visible on md+ */}
  <Show when={isMd()}>
    <TooltipKeybind title={language.t("command.review.toggle")} keybind={command.keybind("review.toggle")}>
      <Button
        variant="ghost"
        class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
        onClick={() => view().reviewPanel.toggle()}
        aria-label={language.t("command.review.toggle")}
        aria-expanded={view().reviewPanel.opened()}
        aria-controls="review-panel"
      >
        <Icon size="small" name={view().reviewPanel.opened() ? "review-active" : "review"} />
      </Button>
    </TooltipKeybind>

    <TooltipKeybind title={language.t("command.fileTree.toggle")} keybind={command.keybind("fileTree.toggle")}>
      <Button
        variant="ghost"
        class="titlebar-icon w-8 h-6 p-0 box-border"
        onClick={() => layout.fileTree.toggle()}
        aria-label={language.t("command.fileTree.toggle")}
        aria-expanded={layout.fileTree.opened()}
        aria-controls="file-tree-panel"
      >
        <div class="relative flex items-center justify-center size-4">
          <Icon
            size="small"
            name={layout.fileTree.opened() ? "file-tree-active" : "file-tree"}
            classList={{
              "text-icon-strong": layout.fileTree.opened(),
              "text-icon-weak": !layout.fileTree.opened(),
            }}
          />
        </div>
      </Button>
    </TooltipKeybind>
  </Show>

  {/* Overflow menu for hidden items */}
  <ToolbarOverflowMenu
    items={[
      {
        id: "review",
        label: language.t("command.review.toggle"),
        icon: view().reviewPanel.opened() ? "review-active" : "review",
        onClick: () => view().reviewPanel.toggle(),
        active: view().reviewPanel.opened(),
        visible: isMd(),
      },
      {
        id: "fileTree",
        label: language.t("command.fileTree.toggle"),
        icon: layout.fileTree.opened() ? "file-tree-active" : "file-tree",
        onClick: () => layout.fileTree.toggle(),
        active: layout.fileTree.opened(),
        visible: isMd(),
      },
      {
        id: "search",
        label: language.t("session.header.searchFiles"),
        icon: "search",
        onClick: () => command.trigger("file.open"),
        visible: isMd(),
      },
      {
        id: "openApp",
        label: language.t("session.header.openIn"),
        icon: "folder",
        onClick: () => openDir(current().id),
        visible: isXl() && canOpen(),
      },
    ]}
  />
</div>
```

Add import for createMediaQuery:

```tsx
import { createMediaQuery } from "@solid-primitives/media"
```

- [ ] **Test the overflow menu manually**

Run: `bun dev --port 4444`
Open: http://localhost:4444
Resize browser to < 768px width
Expected: Overflow menu (⋯) appears, clicking shows hidden options

- [ ] **Commit Step 1.2**

```bash
git add packages/app/src/components/session/session-header.tsx
git commit -m "feat(app): integrate overflow menu into session header"
```

---

## Task 2: Mobile Panel Fullscreen Layout

**Files:**

- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/session-side-panel.tsx`
- Modify: `packages/app/src/context/layout.tsx`

### Step 2.1: Add mobile panel state to layout context

- [ ] **Add mobile panel state management**

Modify file: `packages/app/src/context/layout.tsx`

Add to store type (around line 250):

```tsx
type MobilePanel = {
  active: "session" | "review" | "fileTree" | null
}
```

Add to store initialization (around line 280):

```tsx
mobilePanel: {
  active: null,
} as MobilePanel,
```

Add to return object (around line 690):

```tsx
mobilePanel: {
  active: createMemo(() => store.mobilePanel?.active ?? null),
  set: (panel: "session" | "review" | "fileTree" | null) => {
    setStore("mobilePanel", "active", panel)
  },
  showReview: () => {
    setStore("mobilePanel", "active", "review")
  },
  showFileTree: () => {
    setStore("mobilePanel", "active", "fileTree")
  },
  showSession: () => {
    setStore("mobilePanel", "active", "session")
  },
  hide: () => {
    setStore("mobilePanel", "active", null)
  },
},
```

- [ ] **Commit Step 2.1**

```bash
git add packages/app/src/context/layout.tsx
git commit -m "feat(app): add mobile panel state to layout context"
```

### Step 2.2: Modify session layout for mobile fullscreen panels

- [ ] **Update session.tsx for mobile panel layout**

Modify file: `packages/app/src/pages/session.tsx`

The key change is to make panels take full width on mobile instead of side-by-side.

Find the panel rendering section and wrap with mobile detection:

```tsx
// Around line 380, ensure isDesktop is available
const isDesktop = createMediaQuery("(min-width: 768px)")

// In the render section, modify panel container classes
// When !isDesktop(), panels should be position: fixed, inset: 0, z-index: high
```

The specific changes will depend on the current structure. Key principle:

- `md:` breakpoint classes for side-by-side layout (current behavior)
- Default (no breakpoint) for fullscreen panel on mobile

- [ ] **Commit Step 2.2**

```bash
git add packages/app/src/pages/session.tsx
git commit -m "feat(app): make panels fullscreen on mobile"
```

### Step 2.3: Connect overflow menu to panel switching

- [ ] **Update overflow menu to control mobile panels**

Modify file: `packages/app/src/components/session/toolbar-overflow-menu.tsx`

Update the onClick handlers to also set mobile panel state:

```tsx
// In the items passed to ToolbarOverflowMenu, update:
onClick: () => {
  view().reviewPanel.toggle()
  if (!isMd()) layout.mobilePanel.showReview()
}
```

- [ ] **Commit Step 2.3**

```bash
git add packages/app/src/components/session/session-header.tsx
git commit -m "feat(app): connect overflow menu to mobile panel switching"
```

---

## Task 3: Touch Selection for Comments

**Files:**

- Modify: `packages/ui/src/components/line-comment-annotations.tsx`
- Create: `packages/ui/src/components/touch-selection-toolbar.tsx`

### Step 3.1: Create touch selection toolbar component

- [ ] **Create touch selection toolbar**

Create file: `packages/ui/src/components/touch-selection-toolbar.tsx`

```tsx
import { createSignal, createEffect, onCleanup, Show } from "solid-js"
import { IconButton } from "./icon-button"

type Position = { top: number; left: number }

export function useTouchSelection() {
  const [hasSelection, setHasSelection] = createSignal(false)
  const [position, setPosition] = createSignal<Position | null>(null)

  const checkSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      setHasSelection(false)
      setPosition(null)
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    setHasSelection(true)
    setPosition({
      top: rect.top - 40, // Position above selection
      left: rect.left + rect.width / 2,
    })
  }

  const handleSelectionChange = () => {
    // Delay to allow selection to complete
    setTimeout(checkSelection, 10)
  }

  const handleTouchEnd = () => {
    setTimeout(checkSelection, 100)
  }

  createEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange)
    document.addEventListener("touchend", handleTouchEnd)

    onCleanup(() => {
      document.removeEventListener("selectionchange", handleSelectionChange)
      document.removeEventListener("touchend", handleTouchEnd)
    })
  })

  return {
    hasSelection,
    position,
    clearSelection: () => {
      window.getSelection()?.removeAllRanges()
      setHasSelection(false)
      setPosition(null)
    },
  }
}

export function TouchSelectionToolbar(props: {
  position: Position | null
  onAddComment: () => void
  onClose: () => void
}) {
  return (
    <Show when={props.position}>
      {(pos) => (
        <div
          class="fixed z-50 flex items-center gap-1 bg-surface-panel border border-border-base rounded-lg shadow-lg p-1"
          style={{
            top: `${pos().top}px`,
            left: `${pos().left}px`,
            transform: "translateX(-50%)",
          }}
        >
          <IconButton
            icon="plus"
            variant="ghost"
            size="small"
            onClick={() => {
              props.onAddComment()
              props.onClose()
            }}
            aria-label="Add comment"
          />
        </div>
      )}
    </Show>
  )
}
```

- [ ] **Commit Step 3.1**

```bash
git add packages/ui/src/components/touch-selection-toolbar.tsx
git commit -m "feat(ui): add touch selection toolbar component"
```

### Step 3.2: Integrate touch selection with line comments

- [ ] **Modify line-comment-annotations.tsx for touch support**

Modify file: `packages/ui/src/components/line-comment-annotations.tsx`

Add touch detection and selection toolbar:

```tsx
import { createMediaQuery } from "@solid-primitives/media"
import { TouchSelectionToolbar, useTouchSelection } from "./touch-selection-toolbar"

// In component body:
const isTouch = createMediaQuery("(hover: none)")
const touchSelection = useTouchSelection()

// In render, add touch toolbar when on touch device:
<Show when={isTouch()}>
  <TouchSelectionToolbar
    position={touchSelection.position()}
    onAddComment={() => {
      // Trigger comment dialog with current selection
      commentsUi.onLineSelected(getCurrentSelection())
    }}
    onClose={touchSelection.clearSelection}
  />
</Show>
```

- [ ] **Commit Step 3.2**

```bash
git add packages/ui/src/components/line-comment-annotations.tsx
git commit -m "feat(ui): integrate touch selection with line comments"
```

---

## Task 4: Long-Press Context Menu for File Tree

**Files:**

- Create: `packages/app/src/hooks/use-long-press.ts`
- Modify: `packages/app/src/components/file-tree.tsx`

### Step 4.1: Create long-press hook

- [ ] **Create use-long-press hook**

Create file: `packages/app/src/hooks/use-long-press.ts`

```tsx
import { createSignal, onCleanup } from "solid-js"

type LongPressOptions = {
  delay?: number
  onLongPress: () => void
  onTouchStart?: () => void
  onTouchEnd?: () => void
}

export function useLongPress(options: LongPressOptions) {
  const { delay = 500, onLongPress, onTouchStart, onTouchEnd } = options
  const [isLongPress, setIsLongPress] = createSignal(false)

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let startPos = { x: 0, y: 0 }

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0]
    startPos = { x: touch.clientX, y: touch.clientY }

    onTouchStart?.()

    timeoutId = setTimeout(() => {
      setIsLongPress(true)
      onLongPress()
      // Optional: haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, delay)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!timeoutId) return

    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - startPos.x)
    const dy = Math.abs(touch.clientY - startPos.y)

    // Cancel if moved more than 10px
    if (dx > 10 || dy > 10) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  const handleTouchEnd = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    onTouchEnd?.()
    setIsLongPress(false)
  }

  const bind = {
    ontouchstart: handleTouchStart,
    ontouchmove: handleTouchMove,
    ontouchend: handleTouchEnd,
  }

  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })

  return {
    isLongPress,
    bind,
  }
}
```

- [ ] **Commit Step 4.1**

```bash
git add packages/app/src/hooks/use-long-press.ts
git commit -m "feat(app): add use-long-press hook"
```

### Step 4.2: Add context menu to file tree items

- [ ] **Modify file-tree.tsx to add long-press menu**

Modify file: `packages/app/src/components/file-tree.tsx`

Add imports:

```tsx
import { useLongPress } from "@/hooks/use-long-press"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { createMediaQuery } from "@solid-primitives/media"
```

Add context menu to file items (find the file item render and add):

```tsx
// In FileItem component or equivalent
const prompt = usePrompt()
const language = useLanguage()
const isTouch = createMediaQuery("(hover: none)")
const [contextMenuOpen, setContextMenuOpen] = createSignal(false)

const { bind } = useLongPress({
  onLongPress: () => {
    if (isTouch() && props.node.type === "file") {
      setContextMenuOpen(true)
    }
  },
})

// In render, wrap file item with context menu:
<div {...bind()}>
  {/* existing file item content */}
  <Show when={isTouch()}>
    <DropdownMenu
      open={contextMenuOpen()}
      onOpenChange={setContextMenuOpen}
      gutter={4}
      placement="bottom-start"
    >
      <DropdownMenu.Trigger class="hidden" />
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item
            onSelect={() => {
              prompt.context.add({
                type: "file",
                path: props.node.path,
              })
              setContextMenuOpen(false)
            }}
          >
            <Icon name="plus" size="small" />
            <DropdownMenu.ItemLabel>
              {language.t("fileTree.addToConversation")}
            </DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  </Show>
</div>
```

- [ ] **Add i18n key for "Add to Conversation"**

Add to `packages/app/src/i18n/en.ts`:

```tsx
"fileTree.addToConversation": "Add to conversation",
```

Add to `packages/app/src/i18n/zh.ts`:

```tsx
"fileTree.addToConversation": "添加到对话",
```

- [ ] **Commit Step 4.2**

```bash
git add packages/app/src/components/file-tree.tsx packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): add long-press context menu to file tree"
```

---

## Task 5: Markdown Render Toggle

**Files:**

- Modify: `packages/app/src/pages/session/file-tabs.tsx`
- Create: `packages/app/src/components/markdown-view-toggle.tsx`

### Step 5.1: Create markdown view toggle component

- [ ] **Create markdown view toggle**

Create file: `packages/app/src/components/markdown-view-toggle.tsx`

```tsx
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"

export type MarkdownViewMode = "rendered" | "source"

export function MarkdownViewToggle(props: { mode: MarkdownViewMode; onChange: (mode: MarkdownViewMode) => void }) {
  const language = useLanguage()

  return (
    <div class="flex items-center gap-1 bg-surface-base rounded-md p-0.5">
      <Button
        variant={props.mode === "rendered" ? "secondary" : "ghost"}
        size="small"
        class="px-2 py-0.5 text-12-regular"
        onClick={() => props.onChange("rendered")}
      >
        {language.t("markdown.view.rendered")}
      </Button>
      <Button
        variant={props.mode === "source" ? "secondary" : "ghost"}
        size="small"
        class="px-2 py-0.5 text-12-regular"
        onClick={() => props.onChange("source")}
      >
        {language.t("markdown.view.source")}
      </Button>
    </div>
  )
}
```

- [ ] **Add i18n keys**

Add to `packages/app/src/i18n/en.ts`:

```tsx
"markdown.view.rendered": "Rendered",
"markdown.view.source": "Source",
```

Add to `packages/app/src/i18n/zh.ts`:

```tsx
"markdown.view.rendered": "渲染",
"markdown.view.source": "源码",
```

- [ ] **Commit Step 5.1**

```bash
git add packages/app/src/components/markdown-view-toggle.tsx packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts
git commit -m "feat(app): add markdown view toggle component"
```

### Step 5.2: Integrate markdown toggle into file tabs

- [ ] **Modify file-tabs.tsx to support markdown rendering**

Modify file: `packages/app/src/pages/session/file-tabs.tsx`

Add imports:

```tsx
import { Markdown } from "@opencode-ai/ui/markdown"
import { MarkdownViewToggle, type MarkdownViewMode } from "@/components/markdown-view-toggle"
import { createStore } from "solid-js/store"
```

Add markdown detection and state:

```tsx
// In FileTabContent component
const isMarkdown = createMemo(() => {
  const p = path()
  if (!p) return false
  return p.endsWith(".md") || p.endsWith(".markdown")
})

const [mdViewMode, setMdViewMode] = createStore<Record<string, MarkdownViewMode>>({})

const currentMdMode = createMemo(() => {
  const p = path()
  if (!p) return "rendered"
  return mdViewMode[p] ?? "rendered"
})
```

Modify render function to handle markdown:

```tsx
const renderFile = (source: string) => (
  <div class="relative overflow-hidden pb-40">
    <Show when={isMarkdown()}>
      <div class="absolute top-2 right-4 z-10">
        <MarkdownViewToggle
          mode={currentMdMode()}
          onChange={(mode) => {
            const p = path()
            if (p) setMdViewMode(p, mode)
          }}
        />
      </div>
    </Show>

    <Show
      when={isMarkdown() && currentMdMode() === "rendered"}
      fallback={
        <Dynamic
          component={fileComponent}
          mode="text"
          file={{
            name: path() ?? "",
            contents: source,
            cacheKey: cacheKey(),
          }}
          // ... existing props
        />
      }
    >
      <div class="pt-10 px-4">
        <Markdown content={source} />
      </div>
    </Show>
  </div>
)
```

- [ ] **Commit Step 5.2**

```bash
git add packages/app/src/pages/session/file-tabs.tsx
git commit -m "feat(app): add markdown render/source toggle to file tabs"
```

---

## Task 6: Integration Testing

### Step 6.1: Manual testing checklist

- [ ] **Test overflow menu**

1. Open app on desktop (> 768px)
2. Verify all toolbar buttons visible
3. Resize to < 768px
4. Verify overflow menu appears with hidden options
5. Click overflow items, verify functionality

- [ ] **Test mobile panel layout**

1. Open app on mobile/< 768px
2. Open review panel - verify fullscreen
3. Open file tree - verify fullscreen
4. Switch between panels via overflow menu

- [ ] **Test touch selection**

1. On touch device, open code file
2. Select text by long-press and drag
3. Verify "+" toolbar appears near selection
4. Tap "+", verify comment dialog opens

- [ ] **Test long-press file menu**

1. On touch device, open file tree
2. Long-press a file item (500ms)
3. Verify context menu appears
4. Tap "Add to conversation"
5. Verify file reference appears in chat input

- [ ] **Test markdown toggle**

1. Open a .md file
2. Verify rendered view shows by default
3. Click "Source" button
4. Verify raw markdown shown
5. Click "Rendered" button
6. Verify rendered view returns

### Step 6.2: Commit final changes

```bash
git add -A
git commit -m "feat(app): complete mobile touch optimization

- Add toolbar overflow menu for hidden buttons
- Make panels fullscreen on mobile
- Add touch selection toolbar for comments
- Add long-press context menu for file tree
- Add markdown render/source toggle"
```

---

## Summary

| Task | Description             | Files Changed         |
| ---- | ----------------------- | --------------------- |
| 1    | Toolbar Overflow Menu   | 2 created, 1 modified |
| 2    | Mobile Panel Fullscreen | 3 modified            |
| 3    | Touch Selection         | 1 created, 1 modified |
| 4    | Long-Press Menu         | 1 created, 1 modified |
| 5    | Markdown Toggle         | 1 created, 1 modified |
| 6    | Integration Testing     | Manual verification   |
