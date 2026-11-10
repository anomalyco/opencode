import { For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { useLanguage } from "@/runtime/i18n/language"
import {
  SIDEBAR_GROUPINGS,
  SIDEBAR_ORDERINGS,
  SIDEBAR_SHOW_KEYS,
  SIDEBAR_STATUSES,
  type SidebarFilterKind,
  type SidebarGrouping,
  type SidebarOrdering,
  type SidebarShowKey,
  type SidebarViewState,
} from "./sidebar-view"

type Option = { value: string; label: string }

export function SidebarViewMenu(props: {
  state: SidebarViewState
  servers: { key: string; label: string }[]
  projects: { id: string; label: string }[]
  canToggleAll: boolean
  allCollapsed: boolean
  canMarkRead: boolean
  onGrouping: (value: SidebarGrouping) => void
  onOrdering: (value: SidebarOrdering) => void
  onShow: (key: SidebarShowKey, value: boolean) => void
  onFilter: (kind: SidebarFilterKind, value: string, on: boolean) => void
  onResetFilters: () => void
  onToggleAll: () => void
  onMarkRead: () => void
}): JSX.Element {
  const language = useLanguage()
  const options = (kind: SidebarFilterKind) => filterOptions(kind, props, language.t)
  const active = () => filterCount(props.state)

  // Kobalte closes a submenu only when focus leaves it, and hovering a sibling trigger keeps focus in the parent
  // menu, so without this every submenu hovered stays open on top of the next.
  const [menu, setMenu] = createStore<{ sub: string | undefined }>({ sub: undefined })

  const toggleSub = (key: string, open: boolean) =>
    setMenu("sub", (current) => (open ? key : current === key ? undefined : current))

  return (
    <Menu gutter={4} modal={false} placement="bottom-end" onOpenChange={(open) => !open && setMenu("sub", undefined)}>
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size="small"
        aria-label={language.t("sidebar.view.options")}
        icon={
          <span class="relative inline-flex">
            <Icon name="outline-sliders" size="small" />
            <Show when={active() > 0}>
              <span
                aria-hidden="true"
                class="pointer-events-none absolute -top-1.5 -end-2 min-w-3 rounded-full bg-v2-background-bg-accent px-[3px] text-center text-[9px] leading-3 font-medium tabular-nums text-v2-text-text-contrast"
              >
                {active()}
              </span>
            </Show>
          </span>
        }
      />
      <Menu.Portal>
        <Menu.Content class="min-w-[200px]">
          <Menu.Sub
            gutter={4}
            overflowPadding={16}
            overlap
            open={menu.sub === "grouping"}
            onOpenChange={(open) => toggleSub("grouping", open)}
          >
            <SubTrigger label={language.t("sidebar.view.grouping")}>
              {language.t(`sidebar.view.grouping.${props.state.grouping}`)}
            </SubTrigger>
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[172px]">
                <Menu.RadioGroup
                  value={props.state.grouping}
                  onChange={(value) => {
                    const next = SIDEBAR_GROUPINGS.find((item) => item === value)

                    if (next) props.onGrouping(next)
                  }}
                >
                  <For each={SIDEBAR_GROUPINGS}>
                    {(value) => (
                      <Menu.RadioItem value={value}>{language.t(`sidebar.view.grouping.${value}`)}</Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub
            gutter={4}
            overflowPadding={16}
            overlap
            open={menu.sub === "ordering"}
            onOpenChange={(open) => toggleSub("ordering", open)}
          >
            <SubTrigger label={language.t("sidebar.view.ordering")}>
              {language.t(`sidebar.view.ordering.${props.state.ordering}`)}
            </SubTrigger>
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[172px] max-w-[260px]">
                <Menu.RadioGroup
                  value={props.state.ordering}
                  onChange={(value) => {
                    const next = SIDEBAR_ORDERINGS.find((item) => item === value)

                    if (next) props.onOrdering(next)
                  }}
                >
                  <For each={SIDEBAR_ORDERINGS}>
                    {(value) => (
                      <Menu.RadioItem value={value}>{language.t(`sidebar.view.ordering.${value}`)}</Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
                <Menu.Separator />
                <div class="px-3 py-1.5 text-[11px] leading-4 text-v2-text-text-faint">
                  {language.t("sidebar.view.ordering.hint")}
                </div>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub
            gutter={4}
            overflowPadding={16}
            overlap
            open={menu.sub === "show"}
            onOpenChange={(open) => toggleSub("show", open)}
          >
            <SubTrigger label={language.t("sidebar.view.show")} />
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[172px]">
                <For each={SIDEBAR_SHOW_KEYS}>
                  {(key) => (
                    <Menu.CheckboxItem checked={props.state.show[key]} onChange={(value) => props.onShow(key, value)}>
                      {language.t(`sidebar.view.show.${key}`)}
                    </Menu.CheckboxItem>
                  )}
                </For>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("sidebar.view.filters")}</Menu.GroupLabel>
            <For each={FILTER_KINDS}>
              {(kind) => (
                <Menu.Sub
                  gutter={4}
                  overflowPadding={16}
                  overlap
                  open={menu.sub === `filter:${kind}`}
                  onOpenChange={(open) => toggleSub(`filter:${kind}`, open)}
                >
                  <SubTrigger label={language.t(`sidebar.view.filter.${kind}`)}>
                    <Show when={props.state.filters[kind].length > 0}>{props.state.filters[kind].length}</Show>
                  </SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent class="w-max min-w-[172px] max-w-[280px] !p-0">
                      <MenuScroll class="max-h-[min(20rem,50dvh)]" viewportClass="p-0.5">
                        <For each={options(kind)}>
                          {(option) => (
                            <Menu.CheckboxItem
                              checked={selectedValues(props.state, kind).includes(option.value)}
                              onChange={(on) => props.onFilter(kind, option.value, on)}
                            >
                              <span class="min-w-0 truncate">{option.label}</span>
                            </Menu.CheckboxItem>
                          )}
                        </For>
                      </MenuScroll>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
              )}
            </For>
            <Menu.Item disabled={active() === 0} onSelect={() => props.onResetFilters()}>
              {language.t("sidebar.view.resetFilters")}
            </Menu.Item>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item disabled={!props.canToggleAll} onSelect={() => props.onToggleAll()}>
            {language.t(props.allCollapsed ? "sidebar.view.expandAll" : "sidebar.view.collapseAll")}
          </Menu.Item>
          <Menu.Item disabled={!props.canMarkRead} onSelect={() => props.onMarkRead()}>
            {language.t("sidebar.view.markAllRead")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export function SidebarFilterChips(props: {
  state: SidebarViewState
  servers: { key: string; label: string }[]
  projects: { id: string; label: string }[]
  onRemove: (kind: SidebarFilterKind, value: string) => void
}): JSX.Element {
  const language = useLanguage()

  const chips = () =>
    FILTER_KINDS.flatMap((kind) => {
      const labels = new Map(filterOptions(kind, props, language.t).map((option) => [option.value, option.label]))

      return selectedValues(props.state, kind).map((value) => ({
        kind,
        value,
        label: labels.get(value) ?? value,
      }))
    })

  return (
    <Show when={chips().length > 0}>
      <div class="flex flex-wrap gap-1 px-2 pt-0.5 pb-1.5">
        <For each={chips()}>
          {(chip) => (
            <button
              type="button"
              class="flex h-4 max-w-full min-w-0 items-center gap-0.5 rounded-[4px] bg-v2-overlay-simple-overlay-hover ps-1.5 pe-0.5 text-[11px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base"
              aria-label={language.t("sidebar.view.removeFilter", { label: chip.label })}
              onClick={() => props.onRemove(chip.kind, chip.value)}
            >
              <span class="min-w-0 truncate">{chip.label}</span>
              <Icon name="xmark-small" size="small" class="shrink-0" />
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

const FILTER_KINDS: readonly SidebarFilterKind[] = ["status", "server", "project"]

function SubTrigger(props: { label: string; children?: JSX.Element }) {
  return (
    <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
      <span class="min-w-0 truncate">{props.label}</span>
      <span class="ms-auto shrink-0 text-v2-text-text-faint">{props.children}</span>
    </Menu.SubTrigger>
  )
}

function filterOptions(
  kind: SidebarFilterKind,
  props: { servers: { key: string; label: string }[]; projects: { id: string; label: string }[] },
  t: ReturnType<typeof useLanguage>["t"],
): Option[] {
  if (kind === "status") return SIDEBAR_STATUSES.map((value) => ({ value, label: t(`sidebar.view.status.${value}`) }))

  if (kind === "server") return props.servers.map((server) => ({ value: server.key, label: server.label }))

  return [
    ...props.projects.map((project) => ({ value: project.id, label: project.label })),
    { value: "none", label: t("sidebar.view.project.none") },
  ]
}

function filterCount(state: SidebarViewState) {
  return state.filters.status.length + state.filters.server.length + state.filters.project.length
}

function selectedValues(state: SidebarViewState, kind: SidebarFilterKind): readonly string[] {
  return state.filters[kind]
}
