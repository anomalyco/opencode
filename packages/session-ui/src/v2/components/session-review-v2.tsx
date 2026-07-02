import { IconButton } from "@opencode-ai/ui/icon-button"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import type { SessionReviewDiffStyle } from "../../components/session-review"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import "./session-review-v2.css"

const SIDEBAR_WIDTH_DEFAULT = 240
const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 480

export type SessionReviewExpandMode = "expand" | "collapse"

export type SessionReviewV2Props = {
  title?: JSX.Element
  stats?: JSX.Element
  empty?: JSX.Element
  sidebarOpen?: boolean
  filter: string
  onFilterChange: (value: string) => void
  sidebar?: JSX.Element
  activeFile?: string
  files: string[]
  onSelectFile: (file: string) => void
  diffStyle: SessionReviewDiffStyle
  onDiffStyleChange?: (style: SessionReviewDiffStyle) => void
  expandMode?: SessionReviewExpandMode
  onExpandModeChange?: (mode: SessionReviewExpandMode) => void
  preview?: JSX.Element
  hasDiffs: boolean
  hideSidebar?: boolean
}

export type SessionReviewV2SidebarProps = {
  open: boolean
  variant?: "review" | "files"
  title?: JSX.Element
  stats?: JSX.Element
  filter: string
  onFilterChange: (value: string) => void
  onFilterKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>
  focusFilterToken?: number
  width?: number
  onWidthChange?: (width: number) => void
  minWidth?: number
  maxWidth?: number
  children?: JSX.Element
}

export function SessionReviewV2Sidebar(props: SessionReviewV2SidebarProps) {
  const i18n = useI18n()
  const [resizing, setResizing] = createSignal(false)
  const width = () => props.width ?? SIDEBAR_WIDTH_DEFAULT
  const minWidth = () => props.minWidth ?? SIDEBAR_WIDTH_MIN
  const maxWidth = () => props.maxWidth ?? SIDEBAR_WIDTH_MAX
  let filterInputRef: HTMLInputElement | undefined

  createEffect(() => {
    const token = props.focusFilterToken
    if (!props.open || !token || token <= 0) return
    queueMicrotask(() => {
      if (!props.open) return
      filterInputRef?.focus()
      filterInputRef?.select()
    })
  })

  createEffect(() => {
    if (!resizing()) return
    const stop = () => setResizing(false)
    document.addEventListener("mouseup", stop)
    onCleanup(() => document.removeEventListener("mouseup", stop))
  })

  return (
    <div
      data-component="session-review-v2-sidebar-root"
      data-variant={props.variant ?? "review"}
    >
      <aside
        data-slot="session-review-v2-sidebar"
        data-resizing={resizing() ? "" : undefined}
        aria-hidden={!props.open}
        inert={!props.open}
        style={{ width: props.open ? `${width()}px` : "0px" }}
      >
        <Show when={props.open}>
          <div data-slot="session-review-v2-sidebar-header">
            <div data-slot="session-review-v2-sidebar-title">{props.title}</div>
            <Show when={props.stats}>{props.stats}</Show>
          </div>
          <div data-slot="session-review-v2-sidebar-filter">
            <TextInputV2
              ref={(el) => {
                filterInputRef = el
              }}
              type="search"
              value={props.filter}
              onInput={(event) => props.onFilterChange(event.currentTarget.value)}
              onKeyDown={props.onFilterKeyDown}
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
          >
            {props.children}
          </ScrollView>
        </Show>
      </aside>
      <Show when={props.open && props.onWidthChange}>
        <div
          data-slot="session-review-v2-sidebar-resize"
          onPointerDown={() => setResizing(true)}
        >
          <ResizeHandle
            direction="horizontal"
            size={width()}
            min={minWidth()}
            max={maxWidth()}
            onResize={(next) => props.onWidthChange?.(next)}
          />
        </div>
      </Show>
    </div>
  )
}

export function SessionReviewV2(props: SessionReviewV2Props) {
  const i18n = useI18n()
  const [localExpandMode, setLocalExpandMode] = createSignal<SessionReviewExpandMode>("collapse")

  const expandMode = () => props.expandMode ?? localExpandMode()
  const setExpandMode = (mode: SessionReviewExpandMode) => {
    if (props.expandMode === undefined) setLocalExpandMode(mode)
    props.onExpandModeChange?.(mode)
  }

  const fileIndex = () => {
    const files = props.files
    if (files.length === 0) return -1

    const active = props.activeFile
    const i = active ? files.indexOf(active) : -1
    if (i >= 0) return i
    return 0
  }

  const prev = () => {
    const files = props.files
    if (files.length === 0) return
    return files[(fileIndex() - 1 + files.length) % files.length]
  }

  const next = () => {
    const files = props.files
    if (files.length === 0) return
    return files[(fileIndex() + 1) % files.length]
  }

  const canCycle = () => props.files.length > 0
  const showCollapsedMeta = () => props.sidebarOpen === false

  return (
    <div data-component="session-review-v2">
      <div data-slot="session-review-v2-body">
        <Show when={!props.hideSidebar}>
          <SessionReviewV2Sidebar
            open={props.sidebarOpen ?? true}
            title={props.title}
            stats={props.stats}
            filter={props.filter}
            onFilterChange={props.onFilterChange}
          >
            {props.sidebar}
          </SessionReviewV2Sidebar>
        </Show>

        <div data-slot="session-review-v2-preview">
          <Show when={props.hasDiffs} fallback={props.empty}>
            <div data-slot="session-review-v2-toolbar">
              <div
                data-slot="session-review-v2-toolbar-group"
                class="session-review-v2-toolbar-group--start"
              >
                <Show when={showCollapsedMeta()}>
                  <div data-slot="session-review-v2-toolbar-collapsed-meta">
                    <Show when={props.title}>
                      <div data-slot="session-review-v2-toolbar-title">{props.title}</div>
                    </Show>
                    <Show when={props.stats}>{props.stats}</Show>
                    <Show when={canCycle()}>
                      <span data-slot="session-review-v2-file-position">
                        {fileIndex() + 1}/{props.files.length}
                      </span>
                    </Show>
                  </div>
                </Show>
                <div
                  data-slot="session-review-v2-toolbar-group"
                  class="session-review-v2-toolbar-group--file-nav"
                >
                <TooltipV2
                  openDelay={2000}
                  value={
                    <>
                      {i18n.t("ui.sessionReviewV2.previousFile")}
                      <KeybindV2 keys={["<"]} variant="neutral" />
                    </>
                  }
                >
                  <IconButton
                    icon="arrow-left"
                    variant="ghost"
                    size="small"
                    class="session-review-v2-file-nav-button"
                    disabled={!canCycle()}
                    onClick={() => {
                      const file = prev()
                      if (!file) return
                      props.onSelectFile(file)
                    }}
                    aria-label={i18n.t("ui.sessionReviewV2.previousFile")}
                  />
                </TooltipV2>
                <TooltipV2
                  openDelay={2000}
                  value={
                    <>
                      {i18n.t("ui.sessionReviewV2.nextFile")}
                      <KeybindV2 keys={[">"]} variant="neutral" />
                    </>
                  }
                >
                  <IconButton
                    icon="arrow-right"
                    variant="ghost"
                    size="small"
                    class="session-review-v2-file-nav-button"
                    disabled={!canCycle()}
                    onClick={() => {
                      const file = next()
                      if (!file) return
                      props.onSelectFile(file)
                    }}
                    aria-label={i18n.t("ui.sessionReviewV2.nextFile")}
                  />
                </TooltipV2>
                </div>
              </div>
              <div
                data-slot="session-review-v2-toolbar-group"
                class="session-review-v2-toolbar-group--segments"
              >
                <SegmentedControlV2
                  value={expandMode()}
                  onChange={(value) => {
                    if (value !== "expand" && value !== "collapse") return
                    setExpandMode(value)
                  }}
                  class="session-review-v2-segmented-control session-review-v2-segmented-control--icon"
                  aria-label={i18n.t("ui.sessionReviewV2.expandMode")}
                >
                  <TooltipV2 openDelay={2000} value={i18n.t("ui.sessionReviewV2.showAllLines")}>
                    <SegmentedControlItemV2
                      value="expand"
                      aria-label={i18n.t("ui.sessionReviewV2.showAllLines")}
                    >
                      <IconV2 name="expand" />
                    </SegmentedControlItemV2>
                  </TooltipV2>
                  <TooltipV2 openDelay={2000} value={i18n.t("ui.sessionReviewV2.hideNonDiffLines")}>
                    <SegmentedControlItemV2
                      value="collapse"
                      aria-label={i18n.t("ui.sessionReviewV2.hideNonDiffLines")}
                    >
                      <IconV2 name="collapse" />
                    </SegmentedControlItemV2>
                  </TooltipV2>
                </SegmentedControlV2>
                <Show when={props.onDiffStyleChange}>
                  <SegmentedControlV2
                    value={props.diffStyle}
                    onChange={(value) => {
                      if (value !== "unified" && value !== "split") return
                      props.onDiffStyleChange?.(value)
                    }}
                    class="session-review-v2-segmented-control session-review-v2-segmented-control--icon"
                    aria-label={i18n.t("ui.sessionReviewV2.diffView")}
                  >
                    <TooltipV2 openDelay={2000} value={i18n.t("ui.sessionReviewV2.unifiedDiff")}>
                      <SegmentedControlItemV2
                        value="unified"
                        aria-label={i18n.t("ui.sessionReviewV2.unifiedDiff")}
                      >
                        <IconV2 name="split" />
                      </SegmentedControlItemV2>
                    </TooltipV2>
                    <TooltipV2 openDelay={2000} value={i18n.t("ui.sessionReviewV2.splitDiff")}>
                      <SegmentedControlItemV2
                        value="split"
                        aria-label={i18n.t("ui.sessionReviewV2.splitDiff")}
                      >
                        <IconV2 name="unified" />
                      </SegmentedControlItemV2>
                    </TooltipV2>
                  </SegmentedControlV2>
                </Show>
              </div>
            </div>
            <Show when={props.preview} fallback={<div data-slot="session-review-v2-empty">{props.empty}</div>}>
              {props.preview}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}

export function SessionReviewV2SidebarToggle(props: { opened: boolean; onToggle: () => void }) {
  const i18n = useI18n()

  return (
    <TooltipV2 value={i18n.t("ui.sessionReviewV2.toggleSidebar")}>
      <IconButtonV2
        variant="ghost"
        size="small"
        class="session-review-v2-sidebar-toggle"
        aria-label={i18n.t("ui.sessionReviewV2.toggleSidebar")}
        aria-expanded={props.opened}
        onClick={props.onToggle}
        icon={<IconV2 name="filetree" />}
      />
    </TooltipV2>
  )
}
