import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { type LocalProject } from "@/context/layout"
import type { ServerConnection } from "@/context/server"
import type { useLanguage } from "@/context/language"
import { displayName } from "@/pages/layout/helpers"
import { RECENTLY_CLOSED_DISPLAY_LIMIT } from "@/context/server"
import {
  buildClosedStateMap,
  filterAndSortClosedProjects,
  countClosedStates,
  matchesClosedQuery,
  type ClosedFilter,
  type ClosedSort,
} from "./recently-closed-helpers"

export type HomeRecentlyClosedActions = {
  onReopen: (server: ServerConnection.Any, directory: string) => void
  onArchive: (server: ServerConnection.Any, directory: string) => void
  onUnarchive: (server: ServerConnection.Any, directory: string) => void
  onHide: (server: ServerConnection.Any, directory: string) => void
  onUnhide: (server: ServerConnection.Any, directory: string) => void
  onRemove: (server: ServerConnection.Any, project: LocalProject) => void
  onMoveTop: (server: ServerConnection.Any, directory: string) => void
  onBatchReopen: (server: ServerConnection.Any, directories: string[]) => void
  onBatchArchive: (server: ServerConnection.Any, directories: string[]) => void
  onBatchHide: (server: ServerConnection.Any, directories: string[]) => void
  onBatchRemove: (server: ServerConnection.Any, projects: LocalProject[]) => void
}

export function HomeRecentlyClosedSection(props: {
  language: ReturnType<typeof useLanguage>
  server: ServerConnection.Any
  items: LocalProject[]
  homedir: string
  disabled: boolean
  isHidden: (directory: string) => boolean
  isArchived: (directory: string) => boolean
  actions: HomeRecentlyClosedActions
}) {
  const [ui, setUi] = createStore({
    query: "",
    filter: "all" as ClosedFilter,
    sort: "recent" as ClosedSort,
    expanded: false,
    selecting: false,
    selected: {} as Record<string, true>,
    filterOpen: false,
    sortOpen: false,
  })

  const stateMap = createMemo(() => buildClosedStateMap(props.items, props.isHidden, props.isArchived))
  const counts = createMemo(() => countClosedStates(props.items, stateMap()))

  const filtered = createMemo(() =>
    filterAndSortClosedProjects(props.items, stateMap(), { query: ui.query, filter: ui.filter, sort: ui.sort }),
  )

  const visible = createMemo(() => {
    const list = filtered()
    if (ui.expanded) return list
    return list.slice(0, RECENTLY_CLOSED_DISPLAY_LIMIT)
  })

  const selectedDirs = createMemo(() => Object.keys(ui.selected))
  const selectedCount = createMemo(() => selectedDirs().length)
  const allVisibleSelected = createMemo(() => {
    const list = visible()
    if (list.length === 0) return false
    return list.every((project) => ui.selected[project.worktree])
  })

  function toggleSelect(directory: string) {
    if (ui.selected[directory]) {
      setUi("selected", (prev) => {
        const next = { ...prev }
        delete next[directory]
        return next
      })
      return
    }
    setUi("selected", directory, true as const)
  }

  function clearSelection() {
    setUi("selected", {})
    setUi("selecting", false)
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected()) {
      setUi("selected", (prev) => {
        const next = { ...prev }
        for (const project of visible()) delete next[project.worktree]
        return next
      })
      return
    }
    setUi("selected", (prev) => {
      const next = { ...prev }
      for (const project of visible()) next[project.worktree] = true
      return next
    })
  }

  const hasQuery = createMemo(() => ui.query.trim().length > 0)
  const showSearch = createMemo(() => props.items.length > 2 || hasQuery())

  return (
    <div class="flex min-w-0 flex-col gap-1" data-component="home-recently-closed-section">
      <div class="mt-3 flex h-7 min-w-0 shrink-0 items-center justify-between gap-1 pl-1.5 pr-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <div class="truncate text-v2-text-text-faint [font-weight:530]">{props.language.t("home.recentlyClosed")}</div>
          <Show when={props.items.length > 0}>
            <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
              {counts().total}
            </span>
          </Show>
        </div>
        <Show when={props.items.length > 0}>
          <div class="flex shrink-0 items-center gap-0.5">
            <TooltipV2 placement="bottom" value={props.language.t("home.recentlyClosed.select")}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="check" />}
                aria-label={props.language.t("home.recentlyClosed.select")}
                data-action="recently-closed-select"
                onClick={() => {
                  if (ui.selecting) clearSelection()
                  else setUi("selecting", true)
                }}
              />
            </TooltipV2>
            <MenuV2
              gutter={6}
              modal={false}
              placement="bottom-end"
              open={ui.filterOpen}
              onOpenChange={(open) => setUi("filterOpen", open)}
            >
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="outline-sliders" />}
                aria-label={props.language.t("home.recentlyClosed.filter.label")}
                data-action="recently-closed-filter"
              />
              <MenuV2.Portal>
                <MenuV2.Content>
                  <MenuV2.RadioGroup value={ui.filter} onChange={(value) => setUi("filter", value as ClosedFilter)}>
                    <MenuV2.RadioItem value="all" onSelect={() => setUi("filter", "all")}>
                      {props.language.t("home.recentlyClosed.filter.all")}
                    </MenuV2.RadioItem>
                    <MenuV2.RadioItem value="recent" onSelect={() => setUi("filter", "recent")}>
                      {props.language.t("home.recentlyClosed.filter.recent")}
                    </MenuV2.RadioItem>
                    <MenuV2.RadioItem value="archived" onSelect={() => setUi("filter", "archived")}>
                      {props.language.t("home.recentlyClosed.filter.archived")} ({counts().archived})
                    </MenuV2.RadioItem>
                    <MenuV2.RadioItem value="hidden" onSelect={() => setUi("filter", "hidden")}>
                      {props.language.t("home.recentlyClosed.filter.hidden")} ({counts().hidden})
                    </MenuV2.RadioItem>
                  </MenuV2.RadioGroup>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
            <MenuV2
              gutter={6}
              modal={false}
              placement="bottom-end"
              open={ui.sortOpen}
              onOpenChange={(open) => setUi("sortOpen", open)}
            >
              <MenuV2.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="small"
                icon={<IconV2 name="menu" />}
                aria-label={props.language.t("home.recentlyClosed.sort.label")}
                data-action="recently-closed-sort"
              />
              <MenuV2.Portal>
                <MenuV2.Content>
                  <MenuV2.RadioGroup value={ui.sort} onChange={(value) => setUi("sort", value as ClosedSort)}>
                    <MenuV2.RadioItem value="recent" onSelect={() => setUi("sort", "recent")}>
                      {props.language.t("home.recentlyClosed.sort.recent")}
                    </MenuV2.RadioItem>
                    <MenuV2.RadioItem value="name-asc" onSelect={() => setUi("sort", "name-asc")}>
                      {props.language.t("home.recentlyClosed.sort.nameAsc")}
                    </MenuV2.RadioItem>
                    <MenuV2.RadioItem value="name-desc" onSelect={() => setUi("sort", "name-desc")}>
                      {props.language.t("home.recentlyClosed.sort.nameDesc")}
                    </MenuV2.RadioItem>
                  </MenuV2.RadioGroup>
                </MenuV2.Content>
              </MenuV2.Portal>
            </MenuV2>
          </div>
        </Show>
      </div>

      <Show when={props.items.length > 0 && showSearch()}>
        <div class="flex min-w-0 items-center gap-1.5 rounded-[6px] border border-v2-border-border-base bg-transparent px-1.5 py-1">
          <IconV2 name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <input
            type="text"
            value={ui.query}
            onInput={(event) => setUi("query", event.currentTarget.value)}
            placeholder={props.language.t("home.recentlyClosed.search.placeholder")}
            aria-label={props.language.t("home.recentlyClosed.search.placeholder")}
            data-action="recently-closed-search"
            class="min-w-0 flex-1 bg-transparent text-[12px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
          />
          <Show when={hasQuery()}>
            <button
              type="button"
              aria-label={props.language.t("common.clear")}
              data-action="recently-closed-clear-search"
              class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              onClick={() => setUi("query", "")}
            >
              <IconV2 name="xmark-small" size="small" />
            </button>
          </Show>
        </div>
      </Show>

      <Show when={ui.selecting && props.items.length > 0}>
        <div
          class="flex min-w-0 items-center justify-between gap-2 rounded-[6px] bg-v2-background-bg-layer-01 px-1.5 py-1"
          data-component="recently-closed-selection-bar"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              data-action="recently-closed-toggle-all"
              class="shrink-0 rounded-[4px] px-1 py-0.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              onClick={toggleSelectAllVisible}
            >
              {allVisibleSelected()
                ? props.language.t("home.recentlyClosed.deselectAll")
                : props.language.t("home.recentlyClosed.selectAll")}
            </button>
            <span class="truncate text-[11px] text-v2-text-text-muted">
              {props.language.t("home.recentlyClosed.selected", { count: selectedCount() })}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-0.5">
            <Show when={selectedCount() > 0}>
              <TooltipV2 placement="bottom" value={props.language.t("home.recentlyClosed.action.reopen")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="folder" />}
                  aria-label={props.language.t("home.recentlyClosed.action.reopen")}
                  data-action="recently-closed-batch-reopen"
                  disabled={props.disabled}
                  onClick={() => {
                    props.actions.onBatchReopen(props.server, selectedDirs())
                    clearSelection()
                  }}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.language.t("home.recentlyClosed.action.archive")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="archive" />}
                  aria-label={props.language.t("home.recentlyClosed.action.archive")}
                  data-action="recently-closed-batch-archive"
                  disabled={props.disabled}
                  onClick={() => {
                    props.actions.onBatchArchive(props.server, selectedDirs())
                    clearSelection()
                  }}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.language.t("home.recentlyClosed.action.hide")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="outline-xmark" />}
                  aria-label={props.language.t("home.recentlyClosed.action.hide")}
                  data-action="recently-closed-batch-hide"
                  disabled={props.disabled}
                  onClick={() => {
                    props.actions.onBatchHide(props.server, selectedDirs())
                    clearSelection()
                  }}
                />
              </TooltipV2>
              <TooltipV2 placement="bottom" value={props.language.t("home.recentlyClosed.action.remove")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<IconV2 name="close" />}
                  aria-label={props.language.t("home.recentlyClosed.action.remove")}
                  data-action="recently-closed-batch-remove"
                  disabled={props.disabled}
                  onClick={() => {
                    const projects = filtered().filter((project) => ui.selected[project.worktree])
                    props.actions.onBatchRemove(props.server, projects)
                    clearSelection()
                  }}
                />
              </TooltipV2>
            </Show>
            <button
              type="button"
              data-action="recently-closed-cancel-selection"
              class="shrink-0 rounded-[4px] px-1 py-0.5 text-[11px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              onClick={clearSelection}
            >
              {props.language.t("home.recentlyClosed.cancelSelection")}
            </button>
          </div>
        </div>
      </Show>

      <Show
        when={props.items.length > 0}
        fallback={
          <div class="flex min-w-0 flex-col gap-1 px-1.5 py-2" data-component="recently-closed-empty">
            <div class="text-[12px] text-v2-text-text-faint">{props.language.t("home.recentlyClosed.empty")}</div>
            <div class="text-[11px] text-v2-text-text-faint opacity-80">
              {props.language.t("home.recentlyClosed.empty.description")}
            </div>
          </div>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="px-1.5 py-2 text-[12px] text-v2-text-text-faint" data-component="recently-closed-no-results">
              {hasQuery()
                ? props.language.t("home.recentlyClosed.noResults", { query: ui.query.trim() })
                : props.language.t("home.recentlyClosed.empty")}
            </div>
          }
        >
          <For each={visible()}>
            {(project) => (
              <RecentlyClosedRow
                language={props.language}
                server={props.server}
                project={project}
                homedir={props.homedir}
                disabled={props.disabled}
                selecting={ui.selecting}
                selected={!!ui.selected[project.worktree]}
                hidden={props.isHidden(project.worktree)}
                archived={props.isArchived(project.worktree)}
                onToggleSelect={() => toggleSelect(project.worktree)}
                actions={props.actions}
              />
            )}
          </For>
          <Show when={filtered().length > RECENTLY_CLOSED_DISPLAY_LIMIT}>
            <button
              type="button"
              data-action={ui.expanded ? "recently-closed-show-less" : "recently-closed-show-more"}
              class="flex h-7 min-w-0 items-center px-1.5 text-left text-[12px] text-v2-text-text-muted hover:text-v2-text-text-base"
              onClick={() => setUi("expanded", !ui.expanded)}
            >
              {ui.expanded
                ? props.language.t("home.recentlyClosed.showLess")
                : props.language.t("home.recentlyClosed.showMore", { count: filtered().length })}
            </button>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

function RecentlyClosedRow(props: {
  language: ReturnType<typeof useLanguage>
  server: ServerConnection.Any
  project: LocalProject
  homedir: string
  disabled: boolean
  selecting: boolean
  selected: boolean
  hidden: boolean
  archived: boolean
  onToggleSelect: () => void
  actions: HomeRecentlyClosedActions
}) {
  const path = () => {
    const home = props.homedir
    const worktree = props.project.worktree
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }

  return (
    <div class="group/closed relative flex h-7 min-w-0 items-center gap-1 rounded-[6px]">
      <Show when={props.selecting}>
        <button
          type="button"
          role="checkbox"
          aria-checked={props.selected}
          aria-label={displayName(props.project)}
          data-action="recently-closed-toggle-select"
          data-selected={props.selected ? "" : undefined}
          class={`
            flex size-5 shrink-0 items-center justify-center rounded-[4px] border
            ${props.selected ? "border-transparent bg-v2-background-bg-accent text-white" : "border-v2-border-border-base text-transparent"}
          `}
          onClick={props.onToggleSelect}
        >
          <IconV2 name="check" size="small" />
        </button>
      </Show>
      <TooltipV2 placement="right" value={path()}>
        <button
          type="button"
          data-component="home-recently-closed-row"
          disabled={props.disabled}
          onClick={() => {
            if (props.selecting) {
              props.onToggleSelect()
              return
            }
            props.actions.onReopen(props.server, props.project.worktree)
          }}
          class={`
            flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-left
            text-v2-text-text-muted [font-weight:440] transition-[background-color,color] duration-[120ms]
            hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
            disabled:opacity-60
            ${props.archived || props.hidden ? "opacity-70" : ""}
          `}
        >
          <ProjectAvatar
            fallback={displayName(props.project)}
            src={undefined}
            variant="outline"
          />
          <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {displayName(props.project)}
            </span>
            <Show when={props.archived}>
              <span
                data-component="recently-closed-archived-badge"
                class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted"
              >
                {props.language.t("home.recentlyClosed.archived.badge")}
              </span>
            </Show>
            <Show when={props.hidden}>
              <span
                data-component="recently-closed-hidden-badge"
                class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted"
              >
                {props.language.t("home.recentlyClosed.hidden.badge")}
              </span>
            </Show>
          </span>
        </button>
      </TooltipV2>
      <Show when={!props.selecting}>
        <div class="hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 group-hover/closed:opacity-100 focus-within:opacity-100">
          <MenuV2 gutter={6} modal={false} placement="bottom-end">
            <MenuV2.Trigger
              as={IconButtonV2}
              data-action="recently-closed-menu"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="outline-dots" />}
              aria-label={props.language.t("common.moreOptions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={() => props.actions.onReopen(props.server, props.project.worktree)}>
                  {props.language.t("home.recentlyClosed.action.reopen")}
                </MenuV2.Item>
                <Show
                  when={props.archived}
                  fallback={
                    <MenuV2.Item onSelect={() => props.actions.onArchive(props.server, props.project.worktree)}>
                      {props.language.t("home.recentlyClosed.action.archive")}
                    </MenuV2.Item>
                  }
                >
                  <MenuV2.Item onSelect={() => props.actions.onUnarchive(props.server, props.project.worktree)}>
                    {props.language.t("home.recentlyClosed.action.unarchive")}
                  </MenuV2.Item>
                </Show>
                <Show
                  when={props.hidden}
                  fallback={
                    <MenuV2.Item onSelect={() => props.actions.onHide(props.server, props.project.worktree)}>
                      {props.language.t("home.recentlyClosed.action.hide")}
                    </MenuV2.Item>
                  }
                >
                  <MenuV2.Item onSelect={() => props.actions.onUnhide(props.server, props.project.worktree)}>
                    {props.language.t("home.recentlyClosed.action.unhide")}
                  </MenuV2.Item>
                </Show>
                <MenuV2.Item onSelect={() => props.actions.onMoveTop(props.server, props.project.worktree)}>
                  {props.language.t("home.recentlyClosed.action.moveTop")}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={() => props.actions.onRemove(props.server, props.project)}>
                  {props.language.t("home.recentlyClosed.action.remove")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
          <IconButtonV2
            data-action="recently-closed-reopen"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="plus" />}
            aria-label={props.language.t("home.recentlyClosed.action.reopen")}
            disabled={props.disabled}
            onClick={() => props.actions.onReopen(props.server, props.project.worktree)}
          />
        </div>
      </Show>
    </div>
  )
}


