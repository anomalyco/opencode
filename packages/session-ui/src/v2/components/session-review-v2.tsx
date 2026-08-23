import { useI18n } from "@opencode-ai/ui/context/i18n"
import { SegmentedControlItem, SegmentedControl } from "@opencode-ai/ui/segmented-control"
import { TextInput } from "@opencode-ai/ui/text-input"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { SessionReviewDiffStyle } from "../../components/session-review"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLocale } from "@kobalte/core/i18n"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { getWorkerPool } from "../../pierre/worker"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "./session-file-panel-v2"

export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT = 240
export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN = 200
export const SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX = 480

export type SessionReviewExpandMode = "expand" | "collapse"

export type SessionReviewV2Props = {
  title?: JSX.Element
  stats?: JSX.Element
  empty?: JSX.Element
  sidebarOpen?: boolean
  sidebar?: JSX.Element
  activeFile?: string
  files: string[]
  onSelectFile: (file: string) => void
  diffStyle: SessionReviewDiffStyle
  onDiffStyleChange?: (style: SessionReviewDiffStyle) => void
  expandMode: SessionReviewExpandMode
  onExpandModeChange: (mode: SessionReviewExpandMode) => void
  preview?: JSX.Element
  hasDiffs: boolean
}

export type SessionReviewV2SidebarProps = {
  open: boolean
  transition: boolean
  title?: JSX.Element
  stats?: JSX.Element
  filter: string
  onFilterChange: (value: string) => void
  onFilterKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>
  filterAutofocus?: boolean
  filterRef?: (element: HTMLInputElement) => void
  filterControls?: string
  filterActiveDescendant?: string
  filterExpanded?: boolean
  width?: number
  onWidthChange?: (width: number) => void
  minWidth?: number
  maxWidth?: number
  viewportRef?: (element: HTMLDivElement) => void
  children?: JSX.Element
}

export function SessionReviewV2Sidebar(props: SessionReviewV2SidebarProps) {
  const i18n = useI18n()
  const [resizing, setResizing] = createSignal(false)
  const width = () => props.width ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT
  const minWidth = () => props.minWidth ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN
  const maxWidth = () => props.maxWidth ?? SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX

  createEffect(() => {
    if (!resizing()) return
    const stop = () => setResizing(false)
    makeEventListener(document, "pointerup", stop)
    makeEventListener(document, "pointercancel", stop)
  })

  return (
    <div data-component="session-review-v2-sidebar-root">
      <Show when={props.open}>
        <aside
          data-slot="session-review-v2-sidebar"
          data-transition={props.transition ? "" : undefined}
          data-resizing={resizing() ? "" : undefined}
          style={{ width: `${width()}px` }}
        >
          <div data-slot="session-review-v2-sidebar-header">
            <div data-slot="session-review-v2-sidebar-title">{props.title}</div>
            {props.stats}
          </div>
          <div data-slot="session-review-v2-sidebar-filter">
            <TextInput
              type="search"
              value={props.filter}
              onInput={(event) => props.onFilterChange(event.currentTarget.value)}
              onKeyDown={props.onFilterKeyDown}
              autofocus={props.filterAutofocus}
              ref={props.filterRef}
              role={props.filterControls ? "combobox" : undefined}
              aria-autocomplete={props.filterControls ? "list" : undefined}
              aria-controls={props.filterControls}
              aria-activedescendant={props.filterActiveDescendant}
              aria-expanded={props.filterControls ? props.filterExpanded : undefined}
              showClearButton={props.filter.length > 0}
              clearLabel={i18n.t("ui.list.clearFilter")}
              onClearClick={() => props.onFilterChange("")}
              placeholder={i18n.t("ui.sessionReviewV2.filterFiles")}
              aria-label={i18n.t("ui.sessionReviewV2.filterFiles")}
              leadingIcon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12.25 12.25L10.0625 10.0625M11.0833 6.41667C11.0833 8.994 8.994 11.0833 6.41667 11.0833C3.83934 11.0833 1.75 8.994 1.75 6.41667C1.75 3.83934 3.83934 1.75 6.41667 1.75C8.994 1.75 11.0833 3.83934 11.0833 6.41667Z"
                    stroke="currentColor"
                    stroke-linecap="square"
                  />
                </svg>
              }
            />
          </div>
          <ScrollView
            data-slot="session-review-v2-sidebar-tree"
            class="group/file-tree-v2"
            thumbVisibility="scroll"
            viewportRef={props.viewportRef}
          >
            {props.children}
          </ScrollView>
        </aside>
      </Show>
      <Show when={props.open && props.onWidthChange}>
        <div data-slot="session-review-v2-sidebar-resize" onPointerDown={() => setResizing(true)}>
          <ResizeHandle
            direction="horizontal"
            size={width()}
            min={minWidth()}
            max={maxWidth()}
            onResize={(next) => props.onWidthChange?.(next)}
            onDblClick={() => props.onWidthChange?.(SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT)}
          />
        </div>
      </Show>
    </div>
  )
}

export function SessionReviewV2(props: SessionReviewV2Props) {
  const i18n = useI18n()
  const locale = useLocale()

  createEffect(() => {
    getWorkerPool(props.diffStyle)
  })

  const fileIndex = () => {
    const files = props.files
    if (files.length === 0) return -1

    const active = props.activeFile
    const i = active ? files.indexOf(active) : -1
    if (i >= 0) return i
    return 0
  }

  const prev = () => {
    if (!canCycle()) return
    return props.files[(fileIndex() - 1 + props.files.length) % props.files.length]
  }

  const next = () => {
    if (!canCycle()) return
    return props.files[(fileIndex() + 1) % props.files.length]
  }

  const canCycle = () => props.files.length > 0
  const previousKey = () => (locale.direction() === "rtl" ? "ArrowRight" : "ArrowLeft")
  const nextKey = () => (locale.direction() === "rtl" ? "ArrowLeft" : "ArrowRight")
  const showCollapsedMeta = () => props.sidebarOpen === false
  // Memoize slot getters so Show conditions do not instantiate throwaway elements.
  const title = createMemo(() => props.title)
  const stats = createMemo(() => props.stats)

  const cycle = (file: string | undefined) => {
    if (!file) return
    props.onSelectFile(file)
  }

  // Keep the advertised arrow keys working while the
  // pane is mounted, but never while typing in an input or comment editor.
  makeEventListener(document, "keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key !== previousKey() && event.key !== nextKey()) return
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return
    if (!props.hasDiffs || !canCycle()) return
    const file = event.key === previousKey() ? prev() : next()
    if (!file) return
    event.preventDefault()
    cycle(file)
  })

  const toolbarStart = () => (
    <>
      <Show when={showCollapsedMeta()}>
        <div data-slot="session-review-v2-toolbar-collapsed-meta">
          <Show when={title()}>
            <div data-slot="session-review-v2-toolbar-title">{title()}</div>
          </Show>
          {stats()}
          <Show when={canCycle()}>
            <span data-slot="session-review-v2-file-position">
              {fileIndex() + 1}/{props.files.length}
            </span>
          </Show>
        </div>
      </Show>
      <div class="flex items-center">
        <Tooltip
          openDelay={2000}
          inactive={!prev()}
          value={
            <>
              {i18n.t("ui.sessionReviewV2.previousFile")}
              <Keybind keys={[locale.direction() === "rtl" ? "→" : "←"]} variant="neutral" />
            </>
          }
        >
          <IconButton
            icon={<Icon name="arrow-left" />}
            variant="ghost"
            size="small"
            class="session-review-v2-file-nav-button"
            disabled={!prev()}
            onClick={() => cycle(prev())}
            aria-label={i18n.t("ui.sessionReviewV2.previousFile")}
          />
        </Tooltip>
        <Tooltip
          openDelay={2000}
          inactive={!next()}
          value={
            <>
              {i18n.t("ui.sessionReviewV2.nextFile")}
              <Keybind keys={[locale.direction() === "rtl" ? "←" : "→"]} variant="neutral" />
            </>
          }
        >
          <IconButton
            icon={<Icon name="arrow-right" />}
            variant="ghost"
            size="small"
            class="session-review-v2-file-nav-button"
            disabled={!next()}
            onClick={() => cycle(next())}
            aria-label={i18n.t("ui.sessionReviewV2.nextFile")}
          />
        </Tooltip>
      </div>
    </>
  )

  const toolbarEnd = () => (
    <>
      <SegmentedControl
        value={props.expandMode}
        onChange={(value) => {
          if (value !== "expand" && value !== "collapse") return
          props.onExpandModeChange(value)
        }}
        class="session-review-v2-segmented-control session-review-v2-segmented-control--icon"
        aria-label={i18n.t("ui.sessionReviewV2.expandMode")}
      >
        <Tooltip openDelay={2000} value={i18n.t("ui.sessionReviewV2.showAllLines")}>
          <SegmentedControlItem value="expand" aria-label={i18n.t("ui.sessionReviewV2.showAllLines")}>
            <Icon name="expand" />
          </SegmentedControlItem>
        </Tooltip>
        <Tooltip openDelay={2000} value={i18n.t("ui.sessionReviewV2.hideNonDiffLines")}>
          <SegmentedControlItem value="collapse" aria-label={i18n.t("ui.sessionReviewV2.hideNonDiffLines")}>
            <Icon name="collapse" />
          </SegmentedControlItem>
        </Tooltip>
      </SegmentedControl>
      <Show when={props.onDiffStyleChange}>
        <SegmentedControl
          value={props.diffStyle}
          onChange={(value) => {
            if (value !== "unified" && value !== "split") return
            props.onDiffStyleChange?.(value)
          }}
          class="session-review-v2-segmented-control session-review-v2-segmented-control--icon"
          aria-label={i18n.t("ui.sessionReviewV2.diffView")}
        >
          <Tooltip openDelay={2000} value={i18n.t("ui.sessionReviewV2.unifiedDiff")}>
            <SegmentedControlItem value="unified" aria-label={i18n.t("ui.sessionReviewV2.unifiedDiff")}>
              <Icon name="unified" />
            </SegmentedControlItem>
          </Tooltip>
          <Tooltip openDelay={2000} value={i18n.t("ui.sessionReviewV2.splitDiff")}>
            <SegmentedControlItem value="split" aria-label={i18n.t("ui.sessionReviewV2.splitDiff")}>
              <Icon name="split" />
            </SegmentedControlItem>
          </Tooltip>
        </SegmentedControl>
      </Show>
    </>
  )

  return (
    <SessionFilePanelV2
      sidebar={props.sidebar}
      toolbar={props.hasDiffs}
      toolbarStart={toolbarStart()}
      toolbarEnd={toolbarEnd()}
    >
      <Show when={props.hasDiffs} fallback={props.empty}>
        <Show when={props.activeFile} fallback={<SessionFilePanelV2Empty>{props.empty}</SessionFilePanelV2Empty>}>
          {props.preview}
        </Show>
      </Show>
    </SessionFilePanelV2>
  )
}

export function SessionReviewV2SidebarToggle(props: { opened: boolean; disabled?: boolean; onToggle: () => void }) {
  const i18n = useI18n()

  return (
    <Tooltip value={i18n.t("ui.sessionReviewV2.toggleSidebar")}>
      <IconButton
        variant="ghost"
        size="small"
        class="session-review-v2-sidebar-toggle"
        aria-label={i18n.t("ui.sessionReviewV2.toggleSidebar")}
        aria-expanded={props.opened}
        data-expanded={props.opened ? "" : undefined}
        disabled={props.disabled}
        onClick={props.onToggle}
        icon={<Icon name="filetree" />}
      />
    </Tooltip>
  )
}
