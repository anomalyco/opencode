import { createEffect, createMemo, on, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { SearchHighlight, SearchList, type SearchListHandle } from "@opencode/ui/search-list"
import { Slash } from "@opencode/ui/slash"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { useCommand } from "@/shell/commands/command"
import { useSettingsServers } from "./servers/inventory"
import { useSettingsSurface } from "./surface"
import { rankSettings, type SettingsSearchResult } from "./search-results"
import { settingsSearchIndex } from "./search-index"
import { SettingsSearchEmpty } from "./search-empty"

export function SettingsSearch() {
  const language = useLanguage()
  const command = useCommand()
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const search = surface.search
  const [state, setState] = createStore({ narrow: false, overflow: { start: false, end: false } })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: SearchListHandle<SettingsSearchResult> | undefined

  const updateOverflow = () => {
    if (!input) return
    const offset = Math.abs(input.scrollLeft)
    setState("overflow", {
      start: offset > 1,
      end: input.scrollWidth - input.clientWidth - offset > 1,
    })
  }

  createEffect(on(() => search.state.query, updateOverflow))
  onMount(() => {
    if (input) createResizeObserver(input, updateOverflow)
    const screen = root?.closest<HTMLElement>(".settings-screen")

    if (!screen) return
    setState("narrow", screen.clientWidth < 800)
    createResizeObserver(screen, (rect) => setState("narrow", rect.width < 800))
  })
  command.register("settings.search", () => [
    {
      id: "settings.search.focus",
      title: language.t("settings.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: () => {
        // A root pick in a wide window closes the results but keeps focus, so focusing again would not reopen them.
        search.expand()
        input?.focus({ preventScroll: true })
        input?.select()
      },
    },
  ])

  const catalog = createSettingsSearchCatalog()

  const matches = createMemo(() => rankSettings(search.state.query, catalog()))

  const category = (item: SettingsSearchResult) =>
    item.topLevel
      ? "settings.search.group.pages"
      : !item.entity
        ? "settings.search.group.settings"
        : item.project
          ? "settings.search.group.projects"
          : "settings.search.group.servers"

  // A category's rows stay together, whichever of its groups ranks first, so its header shows once.
  const shown = createMemo(() => {
    const top = matches().slice(0, 60)
    const order = [...new Set(top.map(category))]

    return order.flatMap((key) => top.filter((item) => category(item) === key))
  })

  const iconGroups = createMemo(
    () =>
      new Set(
        shown()
          .filter((item) => item.topLevel || item.projectInfo)
          .map(category),
      ),
  )

  const group = (item: SettingsSearchResult) => {
    if (item.entity && !item.project) return ""

    if (!item.server || servers().length > 1) return item.owner

    return item.projectName ?? ""
  }

  const expanded = () => !!search.state.query.trim() && (!state.narrow || search.state.expanded)

  const select = (item: SettingsSearchResult) => {
    list?.setActive(item.id)

    // A wide layout keeps the results beside the page, so the keys stay with them.
    if (item.view.type === "root" && !state.narrow) input?.focus({ preventScroll: true })
    surface.search.open(item.view, item.id)

    if (state.narrow && item.view.type === "root") {
      input?.blur()
      root?.closest<HTMLElement>(".settings-screen")?.focus({ preventScroll: true })
    }
  }

  const clear = () => {
    search.clear()
    input?.focus()
  }

  return (
    <div ref={root} class="settings-search" data-empty={!search.state.query.trim()}>
      <SearchList
        query={search.state.query}
        onQuery={(query) => search.input(query)}
        placeholder={language.t("settings.search.placeholder")}
        label={language.t("settings.search.results")}
        open={expanded()}
        popover={state.narrow}
        items={shown()}
        key={(item) => item.id}
        section={(item) => `${category(item)}\u0000${group(item)}`}
        header={(item) => (
          <>
            <span class="shrink-0">{language.t(category(item))}</span>
            <Show when={group(item)}>
              {(name) => (
                <>
                  <Slash gap={0} />
                  <bdi dir="auto" class="min-w-0 truncate">
                    {name()}
                  </bdi>
                </>
              )}
            </Show>
          </>
        )}
        empty={<SettingsSearchEmpty query={search.state.query} />}
        footer={matches().length > shown().length ? language.t("settings.search.refine") : undefined}
        scrollTop={search.state.scrollTop}
        onScroll={(top) => search.scroll(top)}
        ref={(handle) => {
          list = handle
          handle.setActive(search.state.highlighted || undefined)
        }}
        onActive={(item) => item && search.highlight(item.id)}
        onSelect={select}
        onKeyDown={(event) => {
          if (event.key === "Escape" && search.state.query) {
            event.preventDefault()
            event.stopPropagation()
            clear()

            return
          }

          if (
            !expanded() &&
            search.state.query.trim() &&
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          ) {
            event.preventDefault()
            search.expand()
          }
        }}
        field={(field) => (
          <TextInput
            {...field}
            ref={input}
            type="search"
            value={search.state.query}
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            placeholder={language.t("settings.search.placeholder")}
            aria-label={language.t("settings.search.placeholder")}
            data-overflow-start={state.overflow.start}
            data-overflow-end={state.overflow.end}
            showClearButton
            clearIcon="circle-xmark"
            onClearClick={clear}
            onFocus={() => search.expand()}
            onScroll={updateOverflow}
            spellcheck={false}
            autocomplete="off"
          />
        )}
      >
        {(item, row) => (
          <button
            type="button"
            {...row}
            tabIndex={-1}
            aria-label={
              item().page === item().title && !item().owner
                ? item().title
                : language.t(
                    item().page === item().title
                      ? "settings.search.page"
                      : item().owner
                        ? "settings.search.result"
                        : "settings.search.result.unscoped",
                    { title: item().title, scope: item().owner, page: item().page },
                  )
            }
            aria-current={search.state.selected === item().id ? "location" : undefined}
            data-setting-target={item().view.target}
            data-result-id={item().id}
            title={[item().owner, item().page].filter(Boolean).join(" › ")}
          >
            <span class="flex min-w-0 items-center gap-2 text-[13px] font-[440] leading-text-compact tracking-[-0.04px]">
              <Show when={iconGroups().has(category(item()))}>
                <span class="flex size-4 shrink-0 items-center justify-center text-v2-icon-icon-muted">
                  <Show
                    when={item().projectInfo}
                    fallback={<Show when={item().topLevel && item().icon}>{(icon) => <Icon name={icon()} />}</Show>}
                  >
                    {(project) => <ProjectIcon project={project()} class="shrink-0" aria-hidden="true" />}
                  </Show>
                </span>
              </Show>
              <bdi dir="auto" class="min-w-0 truncate text-v2-text-text-base">
                <SearchHighlight text={item().title} />
              </bdi>
              <Show when={item().page !== item().title && !(item().entity && item().project)}>
                <span class="min-w-0 truncate text-v2-text-text-muted">{item().page}</span>
              </Show>
            </span>
          </button>
        )}
      </SearchList>
    </div>
  )
}

/** The settings search index for the current platform, servers, and plugins. */
export function createSettingsSearchCatalog() {
  const language = useLanguage()
  const platform = usePlatform()
  const global = useGlobal()
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const mobile = createMediaQuery("(max-width: 767px)")

  const inventory = createMemo(() =>
    servers().map((server) => {
      const context = server.connection ? global.ensureServerCtx(server.connection) : undefined

      return {
        ...server,
        connected: context?.sdk.connection.status() === "connected",
        projects: context ? context.projects.list() : [],
      }
    }),
  )

  return createMemo(() =>
    settingsSearchIndex({
      servers: inventory(),
      selected: surface.server()?.key,
      desktop: platform.platform === "desktop",
      browser: platform.platform === "desktop",
      mobile: mobile(),
      translate: language.t,
      plugins: surface.plugins.items(),
    }),
  )
}
