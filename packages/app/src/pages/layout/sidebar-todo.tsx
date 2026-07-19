import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  closestCenter,
  createSortable,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import type { Issue as IssueType } from "@opencode-ai/sdk/v2"

type Status = NonNullable<IssueType["status"]>
type Priority = NonNullable<IssueType["priority"]>
/**
 * Status name sort order — matches Linear's default workflow state ordering.
 * Used for sorting todos in the sidebar. Unknown/custom status names sort
 * last (indexOf returns -1 → effectively Infinity).
 */
const STATUS_ORDER = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled", "Duplicate"]

const priorityOrder: Priority[] = ["urgent", "high", "medium", "low", "none"]

const STATUSES = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"] as const

/**
 * Archived (terminal) status set — issues in any of these states are
 * read-only in the UI and can only be deleted (not edited). Mirrors the
 * server-side ARCHIVED classification in issue.ts.
 */
const ARCHIVED_STATUSES = new Set<string>(["Done", "Canceled", "Duplicate"])

/**
 * Status pill styling keyed by the Linear workflow state name.
 * Matches the 7 Linear default statuses directly.
 */
const statusClass = (s: string): string => {
  switch (s) {
    case "In Review":
      return "bg-[hsl(130_48%_90%)] text-[hsl(130_48%_35%)] border-[hsl(130_48%_50%)]"
    case "In Progress":
      return "bg-[hsl(48_100%_90%)] text-[hsl(48_100%_30%)] border-[hsl(48_100%_47%)]"
    case "Done":
      return "bg-[hsl(234_57%_90%)] text-[hsl(234_57%_45%)] border-[hsl(234_57%_60%)]"
    case "Canceled":
    case "Duplicate":
      return "bg-[hsl(216_17%_90%)] text-[hsl(216_17%_40%)] border-[hsl(216_17%_65%)]"
    case "Todo":
      return "bg-surface-base text-text-weak border-border-base border-solid"
    case "Backlog":
      return "bg-surface-base text-text-weak border-border-base border-dashed"
    default:
      return "bg-surface-base text-text-weak border-border-base"
  }
}

/**
 * Linear official label colors as HSL components (mirrors Linear workspace
 * label settings). Used for chip rendering in the sidebar and label toggles
 * in the edit dialog.
 */
export const LABEL_COLORS: Record<string, { h: number; s: number; l: number }> = {
  Bug: { h: 0, s: 79, l: 63 },
  Feature: { h: 267, s: 95, l: 76 },
  Improvement: { h: 209, s: 97, l: 65 },
  "ready-for-agent": { h: 234, s: 57, l: 60 },
}

const labelHue = (name: string): number =>
  name.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0) % 360

/**
 * Derive chip {bg, text, border} colors for a label.
 * Known labels use Linear's official palette; unknown labels fall back to
 * a hash-derived hue (preserves distinguishable coloring for custom labels).
 */
export const labelChipColors = (name: string): { bg: string; text: string; border: string } => {
  const known = LABEL_COLORS[name]
  if (known) {
    return {
      bg: `hsl(${known.h} ${known.s}% 95%)`,
      text: `hsl(${known.h} ${known.s}% 35%)`,
      border: `hsl(${known.h} ${known.s}% 82%)`,
    }
  }
  const h = labelHue(name)
  return {
    bg: `hsl(${h} 65% 95%)`,
    text: `hsl(${h} 65% 30%)`,
    border: `hsl(${h} 65% 80%)`,
  }
}

/**
 * Linear-style label abbreviation. Mirrors Linear App's compact chip rendering:
 * the chip shows a short token while `title` retains the full name.
 * Unknown labels fall back to uppercased initials (max 4 chars).
 */
const LABEL_ABBREVIATIONS: Record<string, string> = {
  Feature: "Feat",
  Improvement: "Imp",
  Bug: "Bug",
  "ready-for-agent": "RFA",
}

const labelAbbrev = (name: string): string => {
  const known = LABEL_ABBREVIATIONS[name]
  if (known) return known
  // Fallback: take the first alphanumeric token, uppercase, cap at 4 chars.
  const tokens = name.split(/[\s-_/]+/).filter(Boolean)
  const initials = tokens.map((t) => t[0]?.toUpperCase() ?? "").join("")
  return (initials || name).slice(0, 4)
}

const statusOf = (i: IssueType): Status => i.status ?? "Backlog"
const priorityOf = (i: IssueType): Priority => i.priority ?? "none"
const labelsOf = (i: IssueType): string[] => i.labels ?? []
const isArchived = (i: IssueType): boolean => ARCHIVED_STATUSES.has(statusOf(i))

// Title and description use single-line ellipsis (truncate) so that when the
// sidebar is narrowed the text degrades to "…" instead of wrapping. The
// sidebar header title hides entirely below a container-width threshold
// (see @container on the header row).

/**
 * Priority signal-strength icon — 4 vertical bars (like phone signal).
 * Higher priority = more bars filled. Mirrors Linear's priority iconography.
 */
const PrioritySignalIcon = (props: { priority: Priority }): JSX.Element => {
  const filledCount = () => {
    switch (props.priority) {
      case "urgent":
        return 4
      case "high":
        return 3
      case "medium":
        return 2
      case "low":
        return 1
      default:
        return 0
    }
  }

  const color = () => {
    switch (props.priority) {
      case "urgent":
        return "var(--surface-error-base, #ef4444)"
      case "high":
        return "var(--surface-warning-base, #f59e0b)"
      case "medium":
        return "var(--surface-info-base, #3b82f6)"
      case "low":
        return "var(--text-weaker, #94a3b8)"
      default:
        return "var(--text-weaker, #94a3b8)"
    }
  }

  const bars = [
    { x: 0, y: 8, w: 2, h: 4 },
    { x: 3, y: 6, w: 2, h: 6 },
    { x: 6, y: 4, w: 2, h: 8 },
    { x: 9, y: 2, w: 2, h: 10 },
  ]

  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <For each={bars}>
        {(bar, idx) => (
          <rect
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height={bar.h}
            rx="0.5"
            fill={idx() < filledCount() ? color() : "var(--surface-base, #e2e8f0)"}
            stroke={idx() < filledCount() ? "none" : "var(--border-base, #cbd5e1)"}
            stroke-width="0.5"
          />
        )}
      </For>
    </svg>
  )
}

/**
 * Circular checkbox — a purely visual status indicator. The icon reflects
 * the Linear workflow state name directly:
 *   Backlog, Todo (unstarted)  → empty circle outline
 *   In Progress, In Review (started) → spinner (agent processing)
 *   Done (completed)  → filled circle with checkmark
 *   Canceled, Duplicate (canceled) → circle with diagonal slash
 * Clicking the row opens the edit dialog where the user picks a status
 * from the dynamic selector.
 */
const StatusCheckbox = (props: { status: string; title: string }): JSX.Element => {
  return (
    <span
      class="flex shrink-0 items-center justify-center size-4 rounded-full transition-colors"
      title={props.title}
      aria-label={props.title}
    >
      <Show
        when={props.status === "Done"}
        fallback={
          <Show
            when={props.status === "In Progress" || props.status === "In Review"}
            fallback={
              <Show
                when={props.status === "Canceled" || props.status === "Duplicate"}
                fallback={<span class="size-3 rounded-full border border-border-base" />}
              >
                <span class="relative size-3 rounded-full border border-border-base flex items-center justify-center text-text-weaker">
                  <span class="block w-2 h-px bg-current rotate-45" />
                </span>
              </Show>
            }
          >
            <span class="size-3 rounded-full border border-border-interactive-base border-t-transparent animate-spin" />
          </Show>
        }
      >
        <span class="size-3 rounded-full bg-surface-success-base flex items-center justify-center text-white">
          <svg width="6" height="6" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path
              d="M1.5 4L3.5 6L6.5 2"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </Show>
    </span>
  )
}

/**
 * SortableTodo — wraps a todo row with `createSortable` so it can be
 * dragged within its `DragDropProvider`. The outer wrapper div carries
 * the `use:sortable` directive and fades the source row to 30% opacity
 * while it's being dragged (mirrors the pattern in `SortableProject` /
 * `SortableWorkspace`). The row content itself is unchanged — only the
 * wrapper participates in DnD, so all row-internal click handlers
 * (status cycle, archive button, etc.) keep working because
 * `@thisbeyond/solid-dnd` only triggers a drag after a small pointer
 * movement threshold.
 */
const SortableTodo = (props: { id: string; children: JSX.Element }): JSX.Element => {
  const sortable = createSortable(props.id)
  return (
    <div
      // @ts-ignore — `use:sortable` is a SolidJS directive bound to the
      // local `sortable` variable; the runtime types don't expose it on
      // JSX.IntrinsicElements, hence the ts-ignore (same as
      // `SortableProject` / `SortableWorkspace`).
      use:sortable
      classList={{ "opacity-30": sortable.isActiveDraggable }}
    >
      {props.children}
    </div>
  )
}

/**
 * Reorder helper — given a `DragEvent` and the current id order, splice
 * the dragged id to its new position and call `client.issue.reorder`.
 * `Issue.reorder` on the server groups ids by `parent_id` and assigns
 * sequential `position` values within each group, so L1 and L2 lists
 * can be reordered independently with the same call shape.
 *
 * Returns early (no API call) when:
 *   - `draggable` or `droppable` is missing (drop outside any sortable)
 *   - either id is not in the current list (cross-level drop attempt —
 *     not supported, see ADR-0001 §3.2 two-level hierarchy)
 *   - from === to (no-op)
 */
const makeReorderHandler = (
  directory: Accessor<string>,
  sdk: ReturnType<typeof useServerSDK>,
  serverSync: ReturnType<typeof useServerSync>,
  language: ReturnType<typeof useLanguage>,
  currentIds: () => string[],
) => (event: DragEvent) => {
  const { draggable, droppable } = event
  if (!draggable || !droppable) return
  const fromId = String(draggable.id)
  const toId = String(droppable.id)
  const ids = currentIds()
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from === -1 || to === -1 || from === to) return
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  void (async () => {
    const res = await sdk().client.issue.reorder({
      directory: directory(),
      ids: next,
    })
    if (res.error) {
      showToast({ variant: "error", title: language.t("sidebar.issue.toast.reorderFailed") })
      return
    }
    serverSync().todo.refresh(directory())
  })()
}

export const SidebarTodo = (props: { directory: Accessor<string> }): JSX.Element => {
  const sdk = useServerSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const dialog = useDialog()

  const todos = createMemo<IssueType[]>(() => {
    const [childStore] = serverSync().child(props.directory(), { bootstrap: false })
    return childStore.workspace_todo ?? []
  })

  const archivedTodos = createMemo<IssueType[]>(() => {
    const [childStore] = serverSync().child(props.directory(), { bootstrap: false })
    return childStore.workspace_todo_archived ?? []
  })

  // Sort comparator: status → priority → position (within same parent scope).
  const sortBy = (a: IssueType, b: IssueType): number => {
    const s = STATUS_ORDER.indexOf(statusOf(a)) - STATUS_ORDER.indexOf(statusOf(b))
    if (s !== 0) return s
    const p = priorityOrder.indexOf(priorityOf(a)) - priorityOrder.indexOf(priorityOf(b))
    if (p !== 0) return p
    return Number(a.position) - Number(b.position)
  }

  // L1 and L2 are sorted independently — position is scoped per parent.
  const l1 = createMemo(() =>
    todos()
      .filter((i) => i.level === 0)
      .sort(sortBy),
  )
  const l2ByParent = createMemo(() => {
    const map = todos()
      .filter((i) => i.level === 1 && i.parent_id)
      .reduce((acc, i) => {
        const list = acc.get(i.parent_id!) ?? []
        list.push(i)
        acc.set(i.parent_id!, list)
        return acc
      }, new Map<string, IssueType[]>())
    for (const list of map.values()) list.sort(sortBy)
    return map
  })

  // Archived L1 (level 0 with terminal status) drives the archive area's
  // top-level rows. Archived L2 children of an archived L1 are grouped
  // under their parent; archived L2 whose L1 is still active are shown as
  // orphan rows at the bottom of the archive area.
  const archivedL1 = createMemo(() =>
    archivedTodos()
      .filter((i) => i.level === 0 && isArchived(i))
      .sort(sortBy),
  )
  const archivedL1Ids = createMemo(() => new Set(archivedL1().map((i) => i.id)))
  const archivedL2ByParent = createMemo(() => {
    const map = new Map<string, IssueType[]>()
    for (const i of archivedTodos()) {
      if (i.level !== 1 || !i.parent_id) continue
      // Include L2 if it is archived itself OR its parent L1 is archived.
      if (!isArchived(i) && !archivedL1Ids().has(i.parent_id)) continue
      const list = map.get(i.parent_id) ?? []
      list.push(i)
      map.set(i.parent_id, list)
    }
    for (const list of map.values()) list.sort(sortBy)
    return map
  })

  // UI state for the sidebar: per-item expand flags, archive-area expand
  // flag, and the inline-action confirm target. All folded into a single
  // `createStore` (per packages/app/AGENTS.md "prefer createStore over many
  // createSignal calls") so the reactive surface is one binding.
  const [ui, setUi] = createStore({
    expanded: {} as Record<string, boolean>,
    archiveExpanded: false,
    confirmId: null as string | null,
  })
  const toggleExpand = (id: string) => setUi("expanded", id, !ui.expanded[id])
  const isExpanded = (id: string): boolean => ui.expanded[id] === true

  // Archive area: default collapsed. First expand triggers a fetch of
  // include_archived=true issues via serverSync().todo.refresh.
  const toggleArchive = () => {
    const next = !ui.archiveExpanded
    setUi("archiveExpanded", next)
    if (next) {
      serverSync().todo.refresh(props.directory(), { includeArchived: true })
    }
  }

  // Inline action confirmation: when set, the row shows confirm/cancel
  // buttons instead of the normal × button. The action (archive vs delete)
  // is decided per-issue by isArchived(issue) at confirm time. Avoids
  // Kobalte Dialog overlay event interception issues.
  const setConfirmId = (id: string | null) => setUi("confirmId", id)

  const showCreateDialog = async (parentId?: string) => {
    const { DialogEditTodo } = await import("@/components/dialog-edit-todo")
    dialog.show(() =>
      DialogEditTodo({
        directory: props.directory(),
        mode: "create",
        parentId,
      }),
    )
  }

  // Drag-to-reorder click guard.
  //
  // `@thisbeyond/solid-dnd` is pointer-event based, so the browser still
  // dispatches a `click` after pointerup (unlike HTML5 native DnD which
  // suppresses it). Without this guard, dropping a todo would immediately
  // open the edit dialog because the inner row's `onClick={showEditDialog}`
  // fires right after `onDragEnd`.
  //
  // The guard object is `const` (the reference never changes); only its
  // `dragged` field is mutated. This complies with the root AGENTS.md rule
  // "Prefer const over let. Use ternaries or early returns instead of
  // reassignment." — a cross-callback mutable flag is not a ternary/early
  // return pattern, but the const-object form avoids `let` while preserving
  // the same semantics.
  //
  // Lifecycle: `onDragEnd` sets `dragged = true`, then a `setTimeout(0)`
  // macrotask resets it to `false`. The `click` event fires in the same
  // task as `pointerup` (which triggered `onDragEnd`), so by the time the
  // macrotask runs, the click has already been suppressed by the guard
  // check in `showEditDialog`. If no click fires (e.g., pointerup landed
  // outside any row), the macrotask still resets the flag — no side effect.
  const guard = { dragged: false }

  const showEditDialog = async (todo: IssueType) => {
    if (guard.dragged) return // Suppress the click that follows a drag-end.
    const { DialogEditTodo } = await import("@/components/dialog-edit-todo")
    dialog.show(() =>
      DialogEditTodo({
        directory: props.directory(),
        mode: "edit",
        todo,
      }),
    )
  }

  const triggerAction = (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    setConfirmId(issue.id)
  }

  const confirmAction = (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    setConfirmId(null)
    if (isArchived(issue)) {
      void doDelete(issue.id)
      return
    }
    void doArchive(issue.id)
  }

  const cancelAction = (e: MouseEvent) => {
    e.stopPropagation()
    setConfirmId(null)
  }

  const doDelete = async (id: string) => {
    const res = await sdk().client.issue.delete({ id, directory: props.directory() })
    if (res.error) {
      showToast({ variant: "error", title: language.t("sidebar.issue.toast.deleteFailed") })
      return
    }
    serverSync().todo.refresh(props.directory())
    serverSync().todo.refresh(props.directory(), { includeArchived: true })
  }

  const doArchive = async (id: string) => {
    const res = await sdk().client.issue.archive({
      id,
      directory: props.directory(),
      outcome: "done",
    })
    if (res.error) {
      showToast({ variant: "error", title: language.t("sidebar.issue.toast.archiveFailed") })
      return
    }
    serverSync().todo.refresh(props.directory())
    if (ui.archiveExpanded) {
      serverSync().todo.refresh(props.directory(), { includeArchived: true })
    }
  }

  const priorityLabel = (p: Priority) => language.t(`sidebar.issue.priority.${p}`)

  const cycleStatus = async (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    const current = statusOf(issue)
    const idx = STATUSES.indexOf(current as (typeof STATUSES)[number])
    const next = STATUSES[(idx + 1) % STATUSES.length]
    const res = await sdk().client.issue.update({
      id: issue.id,
      directory: props.directory(),
      patch: { status: next },
    })
    if (!res.error) serverSync().todo.refresh(props.directory())
  }

  const cyclePriority = async (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    const current = priorityOf(issue)
    const idx = priorityOrder.indexOf(current)
    const next = priorityOrder[(idx + 1) % priorityOrder.length]
    const res = await sdk().client.issue.update({
      id: issue.id,
      directory: props.directory(),
      patch: { priority: next },
    })
    if (!res.error) serverSync().todo.refresh(props.directory())
  }

  const renderRow = (issue: IssueType, isL2 = false, isArchivedView = false) => {
    const status = statusOf(issue)
    const priority = priorityOf(issue)
    const labels = labelsOf(issue)
    const hasPriority = priority !== "none"
    const hasDueDate = !!issue.due_date
    const hasLabels = labels.length > 0
    const hasLinearBadge = !!issue.linear_issue_id
    const archived = isArchived(issue)
    // Read-only applies to archived issues OR any issue rendered in the
    // archive area (e.g., an Active L2 whose L1 parent is archived — it
    // is part of an archived subtree's history and should not be editable
    // from the archive view).
    const readOnly = archived || isArchivedView
    // × button availability:
    //   - Active issue (any source): show × → archive action
    //   - Archived non-Linear issue: show × → delete action
    //   - Archived Linear-sourced issue: hide × (Linear MCP has no delete API;
    //     deleting locally would create drift on next sync)
    const canArchive = !archived
    const canDelete = archived && !hasLinearBadge
    const showActionButton = canArchive || canDelete
    const actionTooltip = archived
      ? language.t("sidebar.issue.tooltip.delete")
      : language.t("sidebar.issue.tooltip.archive")
    const actionLabel = archived
      ? language.t("common.delete")
      : language.t("sidebar.issue.confirmArchive")
    // Left group always has status; priority + due_date are optional members.
    // Center group = labels. Right group = Linear badge only.
    const hasCenterGroup = hasLabels
    const hasRightGroup = hasLinearBadge
    // Need a leading spacer when center or right group exists (to push them
    // off the left edge). Need a trailing spacer when center exists without
    // right (to keep actions pinned right while Labels stays centered).
    const needsLeadingSpacer = hasCenterGroup || hasRightGroup
    const needsTrailingSpacer = hasCenterGroup && !hasRightGroup
    // Dividers render between adjacent present groups.
    const dividerAfterLeft = hasCenterGroup || hasRightGroup
    const dividerBetweenCenterAndRight = hasCenterGroup && hasRightGroup

    return (
      <div
        class={`group flex gap-1.5 px-2 py-1 rounded-md transition-colors ${
          readOnly ? "opacity-60" : "hover:bg-surface-raised-base cursor-pointer"
        }`}
        onClick={readOnly ? undefined : () => showEditDialog(issue)}
        role="button"
        tabIndex={readOnly ? -1 : 0}
      >
        {/* Expand/collapse chevron — only for L1 items that have L2 sub-todos.
            Default is collapsed; clicking toggles the sub-todo list visibility.
            In the archive area, uses archivedL2ByParent; otherwise l2ByParent. */}
        <Show
          when={!isL2 && ((isArchivedView ? archivedL2ByParent() : l2ByParent()).get(issue.id) ?? []).length > 0}
        >
          <button
            type="button"
            class="shrink-0 size-4 flex items-center justify-center text-text-weaker hover:text-text-base transition-colors pt-0.5"
            onClick={(e) => {
              e.stopPropagation()
              toggleExpand(issue.id)
            }}
            aria-label={
              isExpanded(issue.id) ? language.t("sidebar.issue.collapse") : language.t("sidebar.issue.expand")
            }
            title={isExpanded(issue.id) ? language.t("sidebar.issue.collapse") : language.t("sidebar.issue.expand")}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              class={`transition-transform ${isExpanded(issue.id) ? "rotate-90" : ""}`}
            >
              <path
                d="M3 1.5L6 4L3 6.5"
                stroke="currentColor"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </Show>
        <div class="flex items-start pt-0.5">
          <StatusCheckbox status={status} title={status} />
        </div>

        {/*
          Three-row stack: tags / title / description.
          Row 1 (tags) splits into three aligned sections per
          ui-ux-pro-max §5 visual-hierarchy + §6 whitespace-balance:
          - Left    (left-aligned)    = Status pill + Priority icon + Due Date
          - Center  (center-aligned)  = Labels (colored chips, abbreviated)
          - Right   (right-aligned)   = Linear badge (source indicator)
          Thin vertical dividers between adjacent present sections improve
          scannability. Action buttons (+/×) stay anchored to the far right,
          outside the three tagged sections.
          Labels render as small colored chips — each chip uses a stable hue
          derived from the label name (Linear App behavior). Chips show
          abbreviations (Feat/Imp/Bug/RFA) to fit without truncation; the
          full name stays in the title tooltip.
          The Linear badge uses a subtle blue tint (Linear brand cue) with
          text-text-base for adequate contrast against the surface.
        */}
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <div class="flex items-center gap-1.5 min-w-0">
            {/* Section 1 — Left group: Status + Priority + Due Date.
              The status pill displays the Linear workflow state name
              verbatim (e.g., "In Progress", "Done") — no i18n mapping.
              Styling is derived from the status name directly.
              For archived / read-only issues, the pill is non-interactive. */}
            <span
              class={`shrink-0 text-9-medium px-1.5 py-0 rounded-md border whitespace-nowrap ${statusClass(status)} ${
                readOnly ? "" : "cursor-pointer hover:opacity-80"
              }`}
              title={readOnly ? status : language.t("sidebar.issue.tooltip.cycleStatus")}
              onClick={readOnly ? undefined : (e) => cycleStatus(e, issue)}
            >
              {status}
            </span>

            <span class="shrink-0 w-px h-3 bg-border-base/70" aria-hidden="true" />
            <span
              class={`shrink-0 flex items-center justify-center px-0.5 ${
                readOnly ? "" : "cursor-pointer hover:opacity-80"
              }`}
              title={readOnly ? language.t("sidebar.issue.priority.none") : language.t("sidebar.issue.tooltip.cyclePriority")}
              onClick={readOnly ? undefined : (e) => cyclePriority(e, issue)}
            >
              <PrioritySignalIcon priority={priority} />
            </span>

            <Show when={hasDueDate}>
              <span class="shrink-0 w-px h-3 bg-border-base/70" aria-hidden="true" />
              <span class="shrink-0 text-9-regular text-text-weak whitespace-nowrap" title={issue.due_date ?? ""}>
                {issue.due_date}
              </span>
            </Show>

            {/* Divider between left group and the next visible group */}
            <Show when={dividerAfterLeft}>
              <span class="shrink-0 w-px h-3 bg-border-base/70" aria-hidden="true" />
            </Show>

            {/* Leading spacer — pushes center/right groups off the left edge */}
            <Show when={needsLeadingSpacer}>
              <div class="flex-1 min-w-0" />
            </Show>

            {/* Section 2 — Center group: Labels (colored chips, abbreviated).
              Shows all labels (no slice/+N truncation) per user requirement —
              chips are short abbreviations so even 4 fit comfortably. */}
            <Show when={hasLabels}>
              <div class="flex items-center gap-0.5 shrink-0">
                <For each={labels}>
                  {(label) => {
                    const c = labelChipColors(label)
                    return (
                      <span
                        class="shrink-0 text-9-regular px-1 py-0 rounded-md border whitespace-nowrap"
                        style={{
                          "background-color": c.bg,
                          color: c.text,
                          "border-color": c.border,
                        }}
                        title={label}
                      >
                        {labelAbbrev(label)}
                      </span>
                    )
                  }}
                </For>
              </div>
            </Show>

            {/* Divider between center labels and right Linear badge */}
            <Show when={dividerBetweenCenterAndRight}>
              <span class="shrink-0 w-px h-3 bg-border-base/70" aria-hidden="true" />
            </Show>

            {/* Trailing spacer — keeps Labels centered when no right group */}
            <Show when={needsTrailingSpacer}>
              <div class="flex-1 min-w-0" />
            </Show>

            {/* Section 3 — Right group: Linear badge (source indicator).
              Neutral surface style (no brand tint) — kept as a low-key source
              tag rather than a primary visual element. */}
            <Show when={hasLinearBadge}>
              <span
                class="shrink-0 text-9-regular px-1 rounded-md bg-surface-base text-text-weak border border-border-base whitespace-nowrap"
                title={language.t("sidebar.issue.tooltip.linkedLinear")}
              >
                {language.t("sidebar.linear.title")}
              </span>
            </Show>

            {/*
              Action buttons — pinned to the far right, outside tagged sections.
              Revealed on row hover (opacity-0 → group-hover:opacity-100) to keep
              the row clean at rest, matching the existing delete-button pattern.
              Rules:
              - × button splits by issue state per spec §6.1:
                Active → archive (issue_archive id,done)
                Archived → delete (issue_delete id)
              - Archived Linear-sourced issues hide × (Linear MCP has no delete
                API; deleting locally would create drift on the next sync).
              - "+" (add sub-todo) only shows for non-archived L1 issues.
              Per-row Linear sync (push/pull of a single issue) is out of scope
              per ADR-0003 step 7; use the bulk sync routes instead.
            */}
            <div class="flex items-center gap-0.5 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <Show when={!isL2 && !readOnly}>
                <button
                  type="button"
                  class="size-4 flex items-center justify-center text-9-regular text-text-weak hover:text-text-base hover:bg-surface-strong-base rounded-md transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    showCreateDialog(issue.id)
                  }}
                  aria-label={language.t("sidebar.issue.addSubtodo")}
                  title={language.t("sidebar.issue.addSubtodo")}
                >
                  +
                </button>
              </Show>
              <Show when={showActionButton}>
                <Show
                  when={ui.confirmId === issue.id}
                  fallback={
                    <button
                      type="button"
                      class="size-4 flex items-center justify-center text-9-regular text-text-weak hover:text-text-base hover:bg-surface-strong-base rounded-md transition-all"
                      onClick={(e) => triggerAction(e, issue)}
                      aria-label={actionTooltip}
                      title={actionTooltip}
                    >
                      ×
                    </button>
                  }
                >
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="px-1.5 h-4 flex items-center justify-center text-9-regular text-on-accent-base bg-accent-danger-base hover:bg-accent-danger-strong rounded text-white transition-colors"
                      onClick={(e) => confirmAction(e, issue)}
                    >
                      {actionLabel}
                    </button>
                    <button
                      type="button"
                      class="px-1.5 h-4 flex items-center justify-center text-9-regular text-text-weak hover:text-text-base bg-surface-strong-base rounded transition-colors"
                      onClick={cancelAction}
                    >
                      {language.t("common.cancel")}
                    </button>
                  </div>
                </Show>
              </Show>
            </div>
          </div>

          {/* Row 2 — title */}
          <span
            class={`min-w-0 truncate text-12-medium text-text-strong ${isL2 ? "text-11-regular text-text-base" : ""}`}
            title={issue.title}
          >
            {issue.title}
          </span>

          {/* Row 3 — description (L1 only). Single-line ellipsis (truncate)
              so a long description degrades to "…" when the sidebar is
              narrowed, rather than wrapping and pushing the row taller.
              Uses text-text-base + medium weight (mirrors the sidebar
              directory path style) for adequate contrast. */}
          <Show when={!isL2 && issue.description}>
            <p class="text-11-medium text-text-base min-w-0 truncate" title={issue.description}>
              {issue.description}
            </p>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <div class="flex-1 min-h-0 px-3 py-2 overflow-y-auto">
      <div class="flex items-center gap-2 mb-1.5">
        <Icon name="task" size="small" class="text-icon-base shrink-0" />
        <span class="text-13-medium text-text-strong flex-1 min-w-0 truncate whitespace-nowrap">
          {language.t("sidebar.issue.title")}
        </span>
        <Button
          size="small"
          variant="secondary"
          icon="plus"
          onClick={() => showCreateDialog()}
          aria-label={language.t("sidebar.issue.add")}
        >
          {language.t("sidebar.issue.add")}
        </Button>
      </div>

      <Show
        when={todos().length > 0}
        fallback={<div class="text-11-regular text-text-base py-2">{language.t("sidebar.issue.empty")}</div>}
      >
        {/*
          L1 drag-and-drop — wraps the L1 list in a DragDropProvider so the
          user can drag L1 rows to reorder them. onDragEnd calls
          `client.issue.reorder` with the new id order; the server's
          `Issue.reorder` groups ids by `parent_id` (null for L1) and
          assigns sequential `position` values. Each L1's expanded L2
          list has its own nested DragDropProvider so L2 rows can be
          reordered independently within their parent's scope.
          Archived rows are not in `todos()` (filtered by `filterByArchive`
          server-side), so they are naturally excluded from the sortable
          set — no need to disable drag per-row.
        */}
        <DragDropProvider
          onDragEnd={(event) => {
            // Set the click-suppression guard before running the reorder
            // handler. The browser will dispatch a `click` right after
            // pointerup (same task); `showEditDialog` checks `guard.dragged`
            // and bails out. The macrotask reset ensures the flag is cleared
            // before any subsequent genuine click.
            guard.dragged = true
            setTimeout(() => {
              guard.dragged = false
            }, 0)
            return makeReorderHandler(
              props.directory,
              sdk,
              serverSync,
              language,
              () => l1().map((i) => i.id),
            )(event)
          }}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <SortableProvider ids={l1().map((i) => i.id)}>
            <div class="flex flex-col gap-0.5">
              <For each={l1()}>
                {(parent) => (
                  <div class="flex flex-col gap-0.5">
                    <SortableTodo id={parent.id}>{renderRow(parent)}</SortableTodo>
                    <Show when={(l2ByParent().get(parent.id) ?? []).length > 0 && isExpanded(parent.id)}>
                      {/*
                        L2 drag-and-drop — nested DragDropProvider scoped to
                        this parent's L2 list. The nested provider takes
                        precedence over the outer L1 provider, so L2 drags
                        stay within their parent's list (no cross-level
                        drag — ADR-0001 §3.2).
                      */}
                      <DragDropProvider
                        onDragEnd={(event) => {
                          // Same click-suppression guard as the L1 provider.
                          // Both providers share the same `guard` object
                          // (component scope), so an L2 drag also suppresses
                          // the post-pointerup click on L2 rows.
                          guard.dragged = true
                          setTimeout(() => {
                            guard.dragged = false
                          }, 0)
                          return makeReorderHandler(
                            props.directory,
                            sdk,
                            serverSync,
                            language,
                            () => (l2ByParent().get(parent.id) ?? []).map((i) => i.id),
                          )(event)
                        }}
                        collisionDetector={closestCenter}
                      >
                        <DragDropSensors />
                        <SortableProvider ids={(l2ByParent().get(parent.id) ?? []).map((i) => i.id)}>
                          <div class="flex flex-col gap-0.5 pl-[22px]">
                            <For each={l2ByParent().get(parent.id) ?? []}>
                              {(kid) => <SortableTodo id={kid.id}>{renderRow(kid, true)}</SortableTodo>}
                            </For>
                          </div>
                        </SortableProvider>
                      </DragDropProvider>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </SortableProvider>
        </DragDropProvider>
      </Show>

      {/*
        Archive area — default collapsed per spec §6.2. Expanding fetches issues
        via issue_list({ include_archived: true }) and renders archived L1 with
        their L2 children (whether L2 is archived or not). Archived Linear-sourced
        issues hide the × button (Linear MCP has no delete API). All rows in this
        area are read-only (no edit, no status/priority cycling, no add sub-todo).
      */}
      <Show when={ui.archiveExpanded}>
        <div class="mt-3 pt-2 border-t border-border-base">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-11-medium text-text-weak flex-1 min-w-0 truncate whitespace-nowrap">
              {language.t("sidebar.issue.archiveArea.title")}
            </span>
            <button
              type="button"
              class="text-9-regular text-text-weaker hover:text-text-base transition-colors"
              onClick={toggleArchive}
              aria-label={language.t("sidebar.issue.archiveArea.collapse")}
              title={language.t("sidebar.issue.archiveArea.collapse")}
            >
              {language.t("sidebar.issue.archiveArea.collapse")}
            </button>
          </div>
          <Show
            when={archivedL1().length > 0}
            fallback={
              <div class="text-11-regular text-text-weaker py-2">
                {language.t("sidebar.issue.archiveArea.empty")}
              </div>
            }
          >
            <div class="flex flex-col gap-0.5">
              <For each={archivedL1()}>
                {(parent) => (
                  <div class="flex flex-col gap-0.5">
                    {renderRow(parent, false, true)}
                    <Show
                      when={(archivedL2ByParent().get(parent.id) ?? []).length > 0 && isExpanded(parent.id)}
                    >
                      <div class="flex flex-col gap-0.5 pl-[22px]">
                        <For each={archivedL2ByParent().get(parent.id) ?? []}>
                          {(kid) => renderRow(kid, true, true)}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={!ui.archiveExpanded}>
        <div class="mt-2">
          <button
            type="button"
            class="text-9-regular text-text-weaker hover:text-text-base transition-colors"
            onClick={toggleArchive}
            aria-label={language.t("sidebar.issue.archiveArea.expand")}
            title={language.t("sidebar.issue.archiveArea.expand")}
          >
            {language.t("sidebar.issue.archiveArea.expand")}
          </button>
        </div>
      </Show>
    </div>
  )
}
