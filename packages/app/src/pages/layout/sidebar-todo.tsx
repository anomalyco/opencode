import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
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
 * Status pill styling keyed by the Linear workflow state name.
 * Matches the 7 Linear default statuses directly.
 */
const statusClass = (s: string): string => {
  switch (s) {
    case "In Progress":
    case "In Review":
      return "bg-surface-info-base/30 text-text-strong border-border-interactive-base"
    case "Done":
      return "bg-surface-success-base/20 text-text-strong border-border-base"
    case "Canceled":
    case "Duplicate":
      return "bg-surface-error-base/20 text-text-base border-border-base"
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

export const SidebarTodo = (props: { directory: Accessor<string> }): JSX.Element => {
  const sdk = useServerSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const dialog = useDialog()

  const todos = createMemo<IssueType[]>(() => {
    const [childStore] = serverSync().child(props.directory(), { bootstrap: false })
    return childStore.workspace_todo ?? []
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
    const map = new Map<string, IssueType[]>()
    for (const i of todos()) {
      if (i.level === 1 && i.parent_id) {
        const list = map.get(i.parent_id) ?? []
        list.push(i)
        map.set(i.parent_id, list)
      }
    }
    for (const list of map.values()) list.sort(sortBy)
    return map
  })

  // Collapse state: L1 items with sub-todos are collapsed by default.
  // expanded[id] === true means expanded; absent/undefined means collapsed.
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const toggleExpand = (id: string) => setExpanded(id, !expanded[id])
  const isExpanded = (id: string): boolean => expanded[id] === true

  // Inline delete confirmation: when set, the row shows confirm/cancel
  // buttons instead of the normal × button. Avoids Kobalte Dialog overlay
  // event interception issues.
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)

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

  const showEditDialog = async (todo: IssueType) => {
    const { DialogEditTodo } = await import("@/components/dialog-edit-todo")
    dialog.show(() =>
      DialogEditTodo({
        directory: props.directory(),
        mode: "edit",
        todo,
      }),
    )
  }

  const removeIssue = (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    setConfirmDeleteId(issue.id)
  }

  const confirmDelete = (e: MouseEvent, issue: IssueType) => {
    e.stopPropagation()
    setConfirmDeleteId(null)
    void doDelete(issue.id)
  }

  const cancelDelete = (e: MouseEvent) => {
    e.stopPropagation()
    setConfirmDeleteId(null)
  }

  const doDelete = async (id: string) => {
    const res = await sdk().client.issue.delete({ id, directory: props.directory() })
    if (res.error) {
      showToast({ variant: "error", title: language.t("sidebar.issue.toast.deleteFailed") })
      return
    }
    serverSync().todo.refresh(props.directory())
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

  const renderRow = (issue: IssueType, isL2 = false) => {
    const status = statusOf(issue)
    const priority = priorityOf(issue)
    const labels = labelsOf(issue)
    const hasPriority = priority !== "none"
    const hasDueDate = !!issue.due_date
    const hasLabels = labels.length > 0
    const hasLinearBadge = !!issue.linear_issue_id
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
        class="group flex gap-1.5 px-2 py-1 rounded-md hover:bg-surface-raised-base cursor-pointer transition-colors"
        onClick={() => showEditDialog(issue)}
        role="button"
        tabIndex={0}
      >
        {/* Expand/collapse chevron — only for L1 items that have L2 sub-todos.
            Default is collapsed; clicking toggles the sub-todo list visibility. */}
        <Show when={!isL2 && (l2ByParent().get(issue.id) ?? []).length > 0}>
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
              Styling is derived from the status name directly. */}
            <span
              class={`shrink-0 text-9-medium px-1.5 py-0 rounded-md border whitespace-nowrap cursor-pointer hover:opacity-80 ${statusClass(status)}`}
              title={language.t("sidebar.issue.tooltip.cycleStatus")}
              onClick={(e) => cycleStatus(e, issue)}
            >
              {status}
            </span>

            <span class="shrink-0 w-px h-3 bg-border-base/70" aria-hidden="true" />
            <span
              class="shrink-0 flex items-center justify-center px-0.5 cursor-pointer hover:opacity-80"
              title={language.t("sidebar.issue.tooltip.cyclePriority")}
              onClick={(e) => cyclePriority(e, issue)}
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
              - Delete (×): hidden for Linear-sourced issues because the Linear
                MCP server exposes no Issue deletion endpoint — deleting locally
                would create drift on the next sync.
              Per-row Linear sync (push/pull of a single issue) is out of scope
              per ADR-0003 step 7; use the bulk sync routes instead.
            */}
            <div class="flex items-center gap-0.5 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <Show when={!isL2}>
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
              <Show when={!hasLinearBadge}>
                <Show
                  when={confirmDeleteId() === issue.id}
                  fallback={
                    <button
                      type="button"
                      class="size-4 flex items-center justify-center text-9-regular text-text-weak hover:text-text-base hover:bg-surface-strong-base rounded-md transition-all"
                      onClick={(e) => removeIssue(e, issue)}
                      aria-label={language.t("common.delete")}
                      title={language.t("common.delete")}
                    >
                      ×
                    </button>
                  }
                >
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="px-1.5 h-4 flex items-center justify-center text-9-regular text-on-accent-base bg-accent-danger-base hover:bg-accent-danger-strong rounded text-white transition-colors"
                      onClick={(e) => confirmDelete(e, issue)}
                    >
                      {language.t("common.delete")}
                    </button>
                    <button
                      type="button"
                      class="px-1.5 h-4 flex items-center justify-center text-9-regular text-text-weak hover:text-text-base bg-surface-strong-base rounded transition-colors"
                      onClick={cancelDelete}
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
        <div class="flex flex-col gap-0.5">
          <For each={l1()}>
            {(parent) => (
              <div class="flex flex-col gap-0.5">
                {renderRow(parent)}
                <Show when={(l2ByParent().get(parent.id) ?? []).length > 0 && isExpanded(parent.id)}>
                  <div class="flex flex-col gap-0.5 pl-[22px]">
                    <For each={l2ByParent().get(parent.id) ?? []}>{(kid) => renderRow(kid, true)}</For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
