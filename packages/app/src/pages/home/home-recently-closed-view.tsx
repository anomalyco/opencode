import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { type LocalProject } from "@/context/layout"
import type { useLanguage } from "@/context/language"
import { RECENTLY_CLOSED_DISPLAY_LIMIT, ServerConnection } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import {
  closedEntries,
  countClosedEntries,
  filterClosedEntries,
  matchesClosedQuery,
  sortClosedEntries,
  type ClosedEntry,
  type ClosedFilter,
  type ClosedSort,
} from "./recently-closed-helpers"

type HomeRecentlyClosedSectionProps = {
  language: ReturnType<typeof useLanguage>
  server: ServerConnection.Any
  items: LocalProject[]
  homedir: string
  disabled: boolean
  isHidden: (directory: string) => boolean
  isArchived: (directory: string) => boolean
  contextMenuOpen: (id: string) => boolean
  onSetContextMenuOpen: (id: string, open: boolean) => void
  onReopen: (directories: string[]) => void
  onArchive: (directories: string[]) => void
  onUnarchive: (directories: string[]) => void
  onHide: (directories: string[]) => void
  onUnhide: (directories: string[]) => void
  onRemove: (projects: LocalProject[]) => void
}

const ROW_BUTTON = `
  flex h-7 min-w-0 w-full shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-left
  text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
  hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base
  focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none
  focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]
  disabled:opacity-60
`

export function HomeRecentlyClosedSection(props: HomeRecentlyClosedSectionProps) {
  const [ui, setUi] = createStore({
    query: "",
    filter: "recent" as ClosedFilter,
    sort: "recent" as ClosedSort,
    expanded: false,
    selecting: false,
    selected: [] as string[],
  })
  const entries = createMemo(() => closedEntries(props.items, props.isHidden, props.isArchived))
  const counts = createMemo(() => countClosedEntries(entries()))
  const filtered = createMemo(() => {
    const matching = entries().filter((entry) => matchesClosedQuery(entry.project, ui.query))
    return sortClosedEntries(filterClosedEntries(matching, ui.filter), ui.sort)
  })
  const visible = createMemo(() => (ui.expanded ? filtered() : filtered().slice(0, RECENTLY_CLOSED_DISPLAY_LIMIT)))
  const selected = createMemo(() => filtered().filter((entry) => ui.selected.includes(entry.project.worktree)))
  const allVisibleSelected = createMemo(
    () => visible().length > 0 && visible().every((entry) => ui.selected.includes(entry.project.worktree)),
  )

  // A selection only ever refers to rows the current view can show.
  createEffect(on([() => ui.filter, () => ui.query], () => setUi("selected", []), { defer: true }))

  const exitSelection = () => setUi({ selecting: false, selected: [] })
  const toggleVisible = () => {
    const shown = visible().map((entry) => entry.project.worktree)
    setUi("selected", (prev) =>
      allVisibleSelected() ? prev.filter((item) => !shown.includes(item)) : [...new Set([...prev, ...shown])],
    )
  }

  return (
    <div
      class="flex min-w-0 flex-col gap-1"
      data-component="home-recently-closed-section"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !ui.selecting) return
        event.preventDefault()
        exitSelection()
      }}
    >
      <div class="mt-3 flex h-7 min-w-0 shrink-0 items-center gap-2 pl-1.5 pr-1">
        <div class="min-w-0 flex-1 truncate text-v2-text-text-faint [font-weight:530]">
          {props.language.t("home.recentlyClosed")}
        </div>
        <Show when={ui.filter !== "recent" || ui.query.trim()}>
          <Tag data-slot="recently-closed-count">{filtered().length}</Tag>
        </Show>
        <MenuV2 gutter={6} modal={false} placement="bottom-end">
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="recently-closed-options"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-sliders" />}
            aria-label={props.language.t("home.recentlyClosed.options")}
            classList={{ "[&_[data-slot=icon-svg]]:text-v2-icon-icon-accent": ui.filter !== "recent" }}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Group>
                <MenuV2.GroupLabel>{props.language.t("home.recentlyClosed.filter.label")}</MenuV2.GroupLabel>
                <MenuV2.RadioGroup value={ui.filter} onChange={(value) => setUi("filter", value as ClosedFilter)}>
                  <MenuV2.RadioItem closeOnSelect value="recent" badge={String(counts().recent)}>
                    {props.language.t("home.recentlyClosed.filter.recent")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="archived" badge={String(counts().archived)}>
                    {props.language.t("home.recentlyClosed.filter.archived")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="hidden" badge={String(counts().hidden)}>
                    {props.language.t("home.recentlyClosed.filter.hidden")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="all" badge={String(counts().all)}>
                    {props.language.t("home.recentlyClosed.filter.all")}
                  </MenuV2.RadioItem>
                </MenuV2.RadioGroup>
              </MenuV2.Group>
              <MenuV2.Separator />
              <MenuV2.Group>
                <MenuV2.GroupLabel>{props.language.t("home.recentlyClosed.sort.label")}</MenuV2.GroupLabel>
                <MenuV2.RadioGroup value={ui.sort} onChange={(value) => setUi("sort", value as ClosedSort)}>
                  <MenuV2.RadioItem closeOnSelect value="recent">
                    {props.language.t("home.recentlyClosed.sort.recent")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="oldest">
                    {props.language.t("home.recentlyClosed.sort.oldest")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="name-asc">
                    {props.language.t("home.recentlyClosed.sort.nameAsc")}
                  </MenuV2.RadioItem>
                  <MenuV2.RadioItem closeOnSelect value="name-desc">
                    {props.language.t("home.recentlyClosed.sort.nameDesc")}
                  </MenuV2.RadioItem>
                </MenuV2.RadioGroup>
              </MenuV2.Group>
              <Show when={!ui.selecting}>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={() => setUi("selecting", true)}>
                  {props.language.t("home.recentlyClosed.select")}
                </MenuV2.Item>
              </Show>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>

      <Show when={props.items.length > RECENTLY_CLOSED_DISPLAY_LIMIT || ui.query}>
        <TextInputV2
          class="!w-full"
          value={ui.query}
          placeholder={props.language.t("home.recentlyClosed.search.placeholder")}
          aria-label={props.language.t("home.recentlyClosed.search.placeholder")}
          leadingIcon={<IconV2 name="magnifying-glass" size="small" />}
          showClearButton={ui.query.length > 0}
          clearLabel={props.language.t("common.clear")}
          onClearClick={() => setUi("query", "")}
          onInput={(event) => setUi("query", event.currentTarget.value)}
          data-action="recently-closed-search"
        />
      </Show>

      <Show when={ui.selecting}>
        <div class="flex h-7 min-w-0 items-center gap-2 pl-1.5 pr-1" data-component="recently-closed-selection-bar">
          <CheckboxV2
            hideLabel
            label={
              allVisibleSelected()
                ? props.language.t("home.recentlyClosed.deselectAll")
                : props.language.t("home.recentlyClosed.selectAll")
            }
            checked={allVisibleSelected()}
            indeterminate={!allVisibleSelected() && selected().length > 0}
            onChange={toggleVisible}
            data-action="recently-closed-select-all"
          />
          <span class="min-w-0 flex-1 truncate text-v2-text-text-muted">
            {props.language.t("home.recentlyClosed.selected", { count: selected().length })}
          </span>
          <MenuV2 gutter={6} modal={false} placement="bottom-end">
            <MenuV2.Trigger
              as={IconButtonV2}
              data-action="recently-closed-batch-menu"
              variant="ghost-muted"
              size="small"
              icon={<IconV2 name="outline-dots" />}
              aria-label={props.language.t("common.moreOptions")}
              disabled={selected().length === 0}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <ClosedMenuItems {...props} entries={selected()} onDone={exitSelection} />
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
          <IconButtonV2
            data-action="recently-closed-cancel-selection"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="close" />}
            aria-label={props.language.t("home.recentlyClosed.cancelSelection")}
            onClick={exitSelection}
          />
        </div>
      </Show>

      <Show
        when={filtered().length > 0}
        fallback={
          <div class="px-1.5 py-1 text-v2-text-text-faint [font-weight:440]" data-component="recently-closed-empty">
            {ui.query.trim()
              ? props.language.t("home.recentlyClosed.noResults", { query: ui.query.trim() })
              : props.language.t("home.recentlyClosed.filter.empty")}
          </div>
        }
      >
        <For each={visible()}>
          {(entry) => (
            <RecentlyClosedRow
              {...props}
              entry={entry}
              selecting={ui.selecting}
              selected={ui.selected.includes(entry.project.worktree)}
              badges={ui.filter === "all"}
              onToggle={() =>
                setUi("selected", (prev) =>
                  prev.includes(entry.project.worktree)
                    ? prev.filter((item) => item !== entry.project.worktree)
                    : [...prev, entry.project.worktree],
                )
              }
            />
          )}
        </For>
        <Show when={filtered().length > RECENTLY_CLOSED_DISPLAY_LIMIT}>
          <button
            type="button"
            data-action={ui.expanded ? "recently-closed-show-less" : "recently-closed-show-more"}
            class={`${ROW_BUTTON} text-v2-text-text-faint`}
            onClick={() => setUi("expanded", !ui.expanded)}
          >
            {ui.expanded
              ? props.language.t("home.recentlyClosed.showLess")
              : props.language.t("home.recentlyClosed.showMore", { count: filtered().length })}
          </button>
        </Show>
      </Show>
    </div>
  )
}

function ClosedMenuItems(
  props: HomeRecentlyClosedSectionProps & {
    entries: ClosedEntry[]
    onDone?: () => void
  },
) {
  const archived = () => props.entries.every((entry) => entry.archived)
  const hidden = () => props.entries.every((entry) => entry.hidden)
  const run = (action: (directories: string[]) => void) => {
    action(props.entries.map((entry) => entry.project.worktree))
    props.onDone?.()
  }
  return (
    <>
      <MenuV2.Item disabled={props.disabled} onSelect={() => run(props.onReopen)}>
        {props.language.t("home.recentlyClosed.action.reopen")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={() => run(archived() ? props.onUnarchive : props.onArchive)}>
        {archived() ? props.language.t("home.recentlyClosed.action.unarchive") : props.language.t("common.archive")}
      </MenuV2.Item>
      <MenuV2.Item onSelect={() => run(hidden() ? props.onUnhide : props.onHide)}>
        {hidden()
          ? props.language.t("home.recentlyClosed.action.unhide")
          : props.language.t("home.recentlyClosed.action.hide")}
      </MenuV2.Item>
      <MenuV2.Separator />
      <MenuV2.Item
        onSelect={() => {
          props.onRemove(props.entries.map((entry) => entry.project))
          props.onDone?.()
        }}
      >
        {props.language.t("home.recentlyClosed.action.remove")}
      </MenuV2.Item>
    </>
  )
}

function RecentlyClosedRow(
  props: HomeRecentlyClosedSectionProps & {
    entry: ClosedEntry
    selecting: boolean
    selected: boolean
    badges: boolean
    onToggle: () => void
  },
) {
  const project = () => props.entry.project
  const path = () => {
    const home = props.homedir
    const worktree = project().worktree
    if (home && (worktree === home || worktree.startsWith(`${home}/`))) return `~${worktree.slice(home.length)}`
    return worktree
  }
  const contextMenuID = () => `recently-closed:${ServerConnection.key(props.server)}:${project().worktree}`
  onCleanup(() => {
    const id = contextMenuID()
    if (props.contextMenuOpen(id)) props.onSetContextMenuOpen(id, false)
  })
  return (
    <div
      class="group/closed relative flex h-7 min-w-0 items-center rounded-[6px]"
      onContextMenu={(event) => {
        if (props.selecting) return
        event.preventDefault()
        props.onSetContextMenuOpen(contextMenuID(), true)
      }}
    >
      <TooltipV2 class="flex min-w-0 flex-1" placement="right" value={path()}>
        <button
          type="button"
          data-component="home-recently-closed-row"
          role={props.selecting ? "checkbox" : undefined}
          aria-checked={props.selecting ? props.selected : undefined}
          class={ROW_BUTTON}
          classList={{ "pr-8": !props.selecting, "opacity-70": props.entry.archived || props.entry.hidden }}
          disabled={!props.selecting && props.disabled}
          onClick={() => {
            if (props.selecting) return props.onToggle()
            props.onReopen([project().worktree])
          }}
        >
          <Show when={props.selecting}>
            <span
              aria-hidden="true"
              class="flex size-4 shrink-0 items-center justify-center rounded-[4px] transition-[background-color,box-shadow] duration-[120ms]"
              classList={{
                "bg-v2-background-bg-accent text-v2-text-text-contrast": props.selected,
                "text-transparent [box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-strong)]": !props.selected,
              }}
            >
              <IconV2 name="check" size="small" />
            </span>
          </Show>
          <ProjectAvatar fallback={displayName(project())} src={undefined} variant="outline" />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{displayName(project())}</span>
          <Show when={props.badges && props.entry.archived}>
            <Tag data-slot="recently-closed-archived">{props.language.t("home.recentlyClosed.archived.badge")}</Tag>
          </Show>
          <Show when={props.badges && props.entry.hidden}>
            <Tag data-slot="recently-closed-hidden">{props.language.t("home.recentlyClosed.hidden.badge")}</Tag>
          </Show>
        </button>
      </TooltipV2>
      <Show when={!props.selecting}>
        <div
          class={`
            hover-reveal absolute right-1 top-1/2 flex -translate-y-1/2 items-center
            group-hover/closed:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100
          `}
          data-menu={props.contextMenuOpen(contextMenuID())}
        >
          <MenuV2
            gutter={6}
            modal={false}
            placement="bottom-end"
            open={props.contextMenuOpen(contextMenuID())}
            onOpenChange={(open) => props.onSetContextMenuOpen(contextMenuID(), open)}
          >
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
                <ClosedMenuItems {...props} entries={[props.entry]} />
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </Show>
    </div>
  )
}
