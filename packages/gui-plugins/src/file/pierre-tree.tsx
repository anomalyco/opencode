import "@pierre/trees/web-components"
import { FileTree, type FileTreeDirectoryHandle, type FileTreeItemHandle } from "@pierre/trees"
import { getIcon } from "@opencode/ui/icons/catalog"
import { createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import type { ChangeKind } from "@opencode/plugin/gui/review"
import { createKeyed, usePlugin, type FileNode, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { startFileDrag } from "./drag"
import { OpenInAppContextMenuV2, useOpenInApp } from "./open-in-app"
import { resolveOpenInAppPath } from "./path"
import {
  createPierreTreeState,
  isPierreTreeMounted,
  needsPierreTreeWiden,
  pierreTreeCompareOrder,
  pierreTreeFileNode,
  pierreTreeOriginalPath,
  pierreTreeRowDecoration,
  runPierreTreeSync,
  shouldScrollPierreTree,
  transitionPierreTree,
  type PierreTreeEffect,
  type PierreTreeEvent,
  type PierreTreeInput,
} from "./pierre-tree-machine"
import {
  buildAllowedTreeInput,
  buildLiveTreeInput,
  collectAllowedCollapsedDirs,
  FILE_TREE_ROW_HEIGHT,
  normalizeFileTreeV2Path,
} from "./tree-model"

const TREE_UNSAFE_CSS = `
  :host {
    color-scheme: inherit;
    --trees-font-family: var(--font-family-sans); --trees-font-size: 12px;
    --trees-fg: var(--v2-text-text-muted); --trees-fg-muted: var(--v2-text-text-muted);
    --trees-bg: var(--v2-background-bg-base); --trees-bg-muted: var(--v2-overlay-simple-overlay-hover);
    --trees-border-color: color-mix(in srgb, var(--v2-border-border-muted) 50%, transparent);
    --trees-indent-guide-bg: color-mix(in srgb, var(--v2-border-border-muted) 50%, transparent);
    --trees-selected-bg: var(--v2-overlay-simple-overlay-pressed); --trees-selected-fg: var(--v2-text-text-base);
    --trees-selected-focused-border-color: transparent; --trees-focus-ring-color: transparent; --trees-focus-ring-width: 0px;
    --trees-git-modified-color: var(--v2-state-fg-info); --trees-git-renamed-color: var(--v2-state-fg-info);
    --trees-git-added-color: var(--v2-state-fg-success); --trees-git-untracked-color: var(--v2-state-fg-success);
    --trees-git-deleted-color: var(--v2-state-fg-danger); --trees-git-ignored-color: var(--v2-text-text-faint);
    --trees-padding-inline: 8px; --trees-item-margin-x: 0px;
  }
  [data-file-tree-virtualized-root="true"] { padding-block-start: 4px; }
  /* The patched scroll limit counts this padding and the horizontal scrollbar, so neither fights the wheel. */
  [data-file-tree-virtualized-scroll="true"] { padding-block: 0 8px; padding-inline: 8px; overflow-x: auto; }
  /* Long rows scroll sideways rather than clip; every row is as wide as the widest one seen in this row set. */
  [data-file-tree-virtualized-list="true"] { width: max-content; min-width: max(100%, var(--file-tree-min-width, 0px)); }
  [data-item-section="spacing"] {
    padding-left: 0;
    padding-inline-start: calc(var(--trees-icon-width) / 2 - 0.5px);
  }
  [data-item-section="spacing-item"] {
    border-left: none; margin-right: 0;
    border-inline-start: 1px solid var(--trees-indent-guide-bg);
    margin-inline-end: calc(var(--trees-level-gap) - 1px);
    transform: none;
  }
  [data-item-section="spacing-item"] + [data-item-section="spacing-item"] {
    margin-left: 0;
    margin-inline-start: calc(var(--trees-item-row-gap) + var(--trees-icon-width) / 2 - 0.5px);
  }
  [data-type="item"][aria-expanded="false"] [data-item-section="icon"] > svg:first-child {
    transform: translateY(var(--trees-icon-nudge));
  }
  [data-type="item"][aria-expanded="true"] [data-item-section="icon"] > svg:first-child {
    transform: translateY(var(--trees-icon-nudge)) rotate(90deg);
  }
  :host(:dir(rtl)) [data-type="item"][aria-expanded="false"] [data-item-section="icon"] > svg:first-child {
    transform: translateY(var(--trees-icon-nudge)) rotate(180deg);
  }
  button[data-type="item"] {
    --row-overlay: transparent;
    box-shadow: none !important; cursor: inherit; font-weight: 500;
  }
  button[data-type="item"]:hover, button[data-type="item"][data-item-context-hover="true"] {
    --row-overlay: var(--v2-overlay-simple-overlay-hover);
    background-color: var(--row-overlay) !important;
  }
  button[data-type="item"][data-item-selected="true"], button[data-type="item"][data-item-selected="true"]:hover {
    --row-overlay: var(--v2-overlay-simple-overlay-pressed);
    color: var(--v2-text-text-base) !important; background-color: var(--row-overlay) !important;
  }
  button[data-type="item"]:focus-visible, button[data-type="item"][data-item-focused="true"] {
    outline: none !important; box-shadow: none !important;
  }
  button[data-type="item"]::before,
  [data-item-section="decoration"]:empty { display: none !important; }
  /* A folder holding changes keeps its lane, so the row still ends in the sticky end, but shows no dot. */
  [data-item-contains-git-change="true"]:not([data-item-git-status]) > [data-item-section="git"] > * { visibility: hidden; }
  [data-type="item"]:not([data-item-selected="true"]) > [data-item-section="icon"] > * { color: var(--v2-icon-icon-muted) !important; }
  [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="content"] { color: inherit; }
  [data-item-section="content"] { flex: 1 0 auto; max-width: none; overflow: visible; white-space: nowrap; }
  [data-item-section="decoration"] { flex: 0 0 auto; color: var(--v2-text-text-weak, var(--v2-text-text-muted)); font-size: 12px; font-weight: 400; }
  [data-item-section="git"] {
    font-size: 11px; font-weight: 530; line-height: 1; letter-spacing: -0.04px;
    font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" on, "lnum" on;
  }
  /* Every row ends in its change letter or an empty lane that sticks inside the pane while long rows scroll. It fades
     the name out over 16px and redraws the row's rounded end, so a row that runs past the pane looks like one that
     fits. */
  [data-item-section="git"] {
    position: sticky; inset-inline-end: var(--trees-item-padding-x);
    z-index: 1; align-self: stretch;
  }
  [data-item-section="git"]::before, [data-item-section="git"]::after {
    content: ""; position: absolute; inset-block: 0; z-index: -1; pointer-events: none;
  }
  /* The pane from the lane to the scroller's 8px edge, under the rounded end's corners. It stays within the row, as rows
     touch and a taller cover would paint over their neighbours. */
  [data-item-section="git"]::before {
    inset-inline: 0 calc(-1 * (var(--trees-item-padding-x) + 8px));
    background: var(--trees-bg);
  }
  /* The row from the 16px fade over the name through its rounded end. */
  [data-item-section="git"]::after {
    inset-inline: -16px calc(-1 * var(--trees-item-padding-x));
    border-start-end-radius: var(--trees-border-radius); border-end-end-radius: var(--trees-border-radius);
    background:
      linear-gradient(to right, transparent, var(--row-overlay) 16px),
      linear-gradient(to right, transparent, var(--trees-bg) 16px);
  }
  :host(:dir(rtl)) [data-item-section="git"]::after {
    background:
      linear-gradient(to left, transparent, var(--row-overlay) 16px),
      linear-gradient(to left, transparent, var(--trees-bg) 16px);
  }
`

function isDirectoryHandle(handle: FileTreeItemHandle | null | undefined): handle is FileTreeDirectoryHandle {
  return Boolean(handle?.isDirectory())
}

function findTreeItemButton(event: Event) {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.type === "item" && target.dataset.itemPath) return target
  }
}

function findFileButtonPath(event: Event) {
  const button = findTreeItemButton(event)

  return button?.dataset.itemType === "file" ? button.dataset.itemPath : undefined
}

export default function PierreFileTree(props: {
  session: MountedSession
  screen: SessionScreen
  active?: string
  allowed?: readonly string[]
  kinds?: ReadonlyMap<string, ChangeKind>
  labels?: ReadonlyMap<string, string>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  onFileDoubleClick?: (file: FileNode) => void
}) {
  const ctx = usePlugin()
  const file = props.screen.file
  const openIn = ctx.desktop ? useOpenInApp({ session: props.session, path: () => file.root }) : undefined
  const live = () => props.allowed === undefined
  const draggable = () => props.draggable ?? true
  const active = () => normalizeFileTreeV2Path(props.active ?? "")
  const expanded = (path: string) => file.tree.state(path)?.expanded ?? false

  const allowedPaths = createMemo(() => (live() ? undefined : (props.allowed ?? [])), undefined, {
    equals: (previous, next) =>
      previous === next ||
      (previous !== undefined &&
        next !== undefined &&
        previous.length === next.length &&
        previous.every((item, index) => item === next[index])),
  })

  const allowedModel = createMemo(() => {
    const paths = allowedPaths()

    return paths ? buildAllowedTreeInput(paths) : undefined
  })

  const liveModel = createMemo(() =>
    live() ? buildLiveTreeInput((path) => file.tree.list(path), expanded) : undefined,
  )

  // The workspace tree and props as the tree should show them; the machine diffs each new one against the tree.
  const input = createMemo((): PierreTreeInput | undefined => {
    const model = liveModel()

    if (model) return { mode: "live", root: file.root, model }
    const allowed = allowedModel()

    if (!allowed) return
    const collapsedDirs = collectAllowedCollapsedDirs(allowed, (dir) => file.tree.state(dir)?.expanded)

    return { mode: "allowed", model: allowed, collapsedDirs, labels: props.labels }
  })

  const synced = (): PierreTreeEvent | undefined => {
    const current = input()

    return current && { type: "synced", input: current, kinds: props.kinds, active: active() }
  }

  const [machine, setMachine] = createSignal(createPierreTreeState())
  const mounted = createMemo(() => isPierreTreeMounted(machine()))
  let wrapper: HTMLDivElement | undefined
  let tree: FileTree | undefined
  let widthHost: HTMLElement | undefined
  let widen: ResizeObserver | undefined

  const dispatch = (event: PierreTreeEvent) => {
    const previous = untrack(machine)
    const next = transitionPierreTree(previous, event)

    if (next.state !== previous) setMachine(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: PierreTreeEffect) => {
    if (effect.type === "mount-tree") {
      mountTree(effect)

      return
    }

    if (effect.type === "cleanup") {
      teardown()

      return
    }

    if (effect.type === "persist-expansion") {
      if (effect.expanded) file.tree.expand(effect.path, effect.list ? undefined : { list: false })
      else file.tree.collapse(effect.path)

      return
    }

    // A new row set measures from the pane's width again.
    if (effect.type === "reset-width") {
      widthHost?.style.removeProperty("--file-tree-min-width")

      return
    }

    if (effect.type === "set-min-width") {
      widthHost?.style.setProperty("--file-tree-min-width", `${effect.width}px`)

      return
    }

    if (effect.type === "schedule-scroll") {
      scheduleScroll(effect.path, effect.attempt)

      return
    }

    const current = tree

    if (!current) return

    if (effect.type === "reset-paths") {
      current.resetPaths(effect.paths, effect.expanded && { initialExpandedPaths: effect.expanded })

      return
    }

    if (effect.type === "batch-paths") {
      current.batch(effect.ops)

      return
    }

    if (effect.type === "sync-expansion") {
      runPierreTreeSync(dispatch, "expansion", () => {
        for (const dir of effect.collapse) {
          const handle = current.getItem(dir)

          if (isDirectoryHandle(handle) && handle.isExpanded()) handle.collapse()
        }

        for (const dir of effect.expand) {
          const handle = current.getItem(dir)

          if (isDirectoryHandle(handle) && !handle.isExpanded()) handle.expand()
        }
      })

      return
    }

    if (effect.type === "select") {
      const selected = current.getSelectedPaths()

      if (effect.path ? selected.length === 1 && selected[0] === effect.path : selected.length === 0) return
      runPierreTreeSync(dispatch, "selection", () => {
        for (const existing of selected) {
          if (existing !== effect.path) current.getItem(existing)?.deselect()
        }

        if (effect.path) current.getItem(effect.path)?.select()
      })

      return
    }

    if (effect.type === "patch-git-status") {
      current.applyGitStatusPatch(effect.patch)

      return
    }

    if (wrapper) current.render({ containerWrapper: wrapper })
  }

  const teardown = () => {
    widen?.disconnect()
    widen = undefined
    // `cleanUp` unmounts the tree but leaves its container in the wrapper, where a remount would stack another.
    const host = tree?.getFileTreeContainer()
    tree?.cleanUp()
    tree = undefined
    widthHost = undefined
    host?.remove()
  }

  const scheduleScroll = (path: string, attempt: number) => {
    queueMicrotask(() => {
      if (!shouldScrollPierreTree(untrack(machine), attempt)) return
      const scroller = tree
        ?.getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]")

      const scrollTop = scroller?.scrollTop ?? 0
      const viewportHeight = scroller?.clientHeight || 600
      const startIndex = Math.floor(scrollTop / FILE_TREE_ROW_HEIGHT)
      const endIndex = Math.max(startIndex, Math.floor((scrollTop + viewportHeight - 1) / FILE_TREE_ROW_HEIGHT))

      // Only scroll when the active file is outside the viewport.
      if (tree && !tree.getVisibleRows(startIndex, endIndex).some((row) => row.path === path)) {
        tree.scrollToPath(path, { focus: false, offset: "nearest" })
      }

      dispatch({ type: "scroll.flushed", attempt })
    })
  }

  const mountTree = (effect: Extract<PierreTreeEffect, { type: "mount-tree" }>) => {
    teardown()

    if (!wrapper) return
    const isLive = effect.mode === "live"

    const created = new FileTree({
      paths: effect.paths,
      flattenEmptyDirectories: false,
      initialExpansion: isLive ? "closed" : "open",
      initialExpandedPaths: effect.expanded,
      initialSelectedPaths: effect.selected ? [effect.selected] : undefined,
      sort: isLive ? (a, b) => pierreTreeCompareOrder(untrack(machine), a.path, b.path) : "default",
      icons: {
        set: "complete",
        spriteSheet: `<svg data-icon-sprite aria-hidden="true" width="0" height="0" xmlns="http://www.w3.org/2000/svg"><symbol id="outline-chevron-right" viewBox="${getIcon("outline-chevron-right").viewBox}" fill="none">${getIcon("outline-chevron-right").body}</symbol></svg>`,
        remap: {
          "file-tree-icon-chevron": { name: "outline-chevron-right", width: 16, height: 16, viewBox: "0 0 16 16" },
        },
      },
      itemHeight: FILE_TREE_ROW_HEIGHT,
      middleTruncate: false,
      stickyFolders: false,
      gitStatus: effect.gitStatus.length > 0 ? effect.gitStatus : undefined,
      dragAndDrop: draggable() ? { canDrag: () => true, canDrop: () => false } : false,
      unsafeCSS: TREE_UNSAFE_CSS,
      renderRowDecoration: ({ row }) => pierreTreeRowDecoration(untrack(machine), row),
      onExpansionChange: (change) =>
        dispatch({ type: "tree.expansion-changed", path: change.path, expanded: change.expanded }),
      onSelectionChange: (selected) => dispatch({ type: "tree.selection-changed", selected }),
    })

    tree = created
    // Collapsed before the first paint, so those folders never flash open.
    if (effect.collapse.length > 0) run({ type: "sync-expansion", expand: [], collapse: effect.collapse })
    created.render({ containerWrapper: wrapper })
    widthHost = created.getFileTreeContainer()
    widthHost?.classList.add("opencode-pierre-file-tree")
    const list = widthHost?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-list]")
    const scroller = list?.closest<HTMLElement>("[data-file-tree-virtualized-scroll]")

    if (!list || !scroller) return

    // Only some rows render, so the list's own width follows the rows on screen. Rows wider than the pane widen the
    // tree, which keeps that width while they scroll out of view; otherwise the scroll position would snap back.
    widen = new ResizeObserver(() => {
      if (scroller.scrollWidth <= scroller.clientWidth) return
      const width = list.getBoundingClientRect().width

      if (needsPierreTreeWiden(untrack(machine), width)) dispatch({ type: "list.measured", width })
    })
    widen.observe(list)
  }

  // The tree mounts once its host element is in the document; later changes reach it through the machine.
  onMount(() => {
    const event = synced()

    if (event) dispatch(event)
  })

  createKeyed(() => mounted() && synced(), dispatch)

  onCleanup(() => dispatch({ type: "disposed" }))

  // The live tree lists the root whenever it is not loaded, e.g. again after the workspace's tree resets.
  createKeyed(
    () => {
      if (!live()) return
      const root = file.tree.state("")

      return root?.loaded ? undefined : { root }
    },
    () => void file.tree.sync(""),
  )

  const resolveContextPath = (event: MouseEvent) => {
    const rawPath = findFileButtonPath(event)

    if (!rawPath) return
    const node = pierreTreeFileNode(machine(), rawPath)

    return resolveOpenInAppPath(file.root, node.absolute || node.path)
  }

  return (
    <OpenInAppContextMenuV2 state={openIn} resolvePath={resolveContextPath} fit>
      <div
        ref={wrapper}
        data-component="file-tree-v2"
        data-total-rows={live() ? (liveModel()?.paths.length ?? 0) : (allowedModel()?.total ?? 0)}
        class="group/file-tree-v2"
        on:keydown={{
          capture: true,
          handleEvent(event: KeyboardEvent) {
            if (!tree || !wrapper?.matches(":dir(rtl)")) return

            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return

            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            event.preventDefault()
            event.stopPropagation()
            const focused = tree.getFocusedItem()

            if (!focused) {
              tree.focusFirstItem()

              return
            }

            const dir = isDirectoryHandle(focused) ? focused : undefined

            if (event.key === "ArrowLeft") {
              if (!dir) return

              if (!dir.isExpanded()) dir.expand()
              else tree.focusNextItem()

              return
            }

            if (dir?.isExpanded()) dir.collapse()
            else tree.focusParentItem()
          },
        }}
        onClick={(event) => {
          const path = findFileButtonPath(event)

          if (path) props.onFileClick?.(pierreTreeFileNode(machine(), path))
        }}
        onDblClick={(event) => {
          const path = findFileButtonPath(event)

          if (path) props.onFileDoubleClick?.(pierreTreeFileNode(machine(), path))
        }}
        onDragStart={(event) => {
          if (!draggable()) return
          const button = findTreeItemButton(event)

          if (button?.dataset.itemPath) startFileDrag(event, pierreTreeOriginalPath(machine(), button.dataset.itemPath))
        }}
      />
    </OpenInAppContextMenuV2>
  )
}
