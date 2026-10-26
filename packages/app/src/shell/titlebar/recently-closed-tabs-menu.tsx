import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useQueries } from "@tanstack/solid-query"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { compareSessionTime } from "@/shell/layout/helpers"
import { mergeHomeSessionIndex } from "@/home/sessions/index"
import { homeSessionsQuery } from "@/home/sessions/queries"
import { listClosedTabs, type ClosedTab } from "@/shell/tabs/closed"
import { sessionIDHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { sessionTabTitle } from "./tab-title"
import "./recently-closed-tabs-menu.css"

export function RecentlyClosedTabsMenu(props: {
  onNewTab: () => void
  tooltip?: JSX.Element
  vertical?: boolean
  keybind?: string
}) {
  const language = useLanguage()
  const tabs = useTabs()
  const global = useGlobal()
  const [state, setState] = createStore({ query: "", open: false })
  let search: HTMLInputElement | undefined

  const recent = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase()

    return listClosedTabs(tabs.closed, tabs.store)
      .filter((entry) => entry.info?.prompted === true)
      .filter((entry) => {
        if (!query) return true
        const title = global.serverCtx(entry.tab.server)?.data.session.get(entry.tab.sessionId)?.title

        return sessionTabTitle(title ?? entry.info?.title, language.t("session.tab.session"))
          .toLocaleLowerCase()
          .includes(query)
      })
      .slice(0, 10)
  })

  const servers = createMemo(() => global.servers.list())
  const sessions = useQueries(() => ({
    queries: servers().map((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return {
        ...homeSessionsQuery(conn, ctx),
        enabled: state.open && recent().length < 10 && ctx?.sdk.connection.status() === "connected",
      }
    }),
  }))

  const other = createMemo(() => {
    if (!state.open || recent().length === 10) return []
    const query = state.query.trim().toLocaleLowerCase()

    return servers()
      .flatMap((conn, index) => {
        const server = ServerConnection.key(conn)
        const ctx = global.serverCtx(server)

        if (!ctx) return []

        return ctx.data.session
          .apply(mergeHomeSessionIndex(sessions[index]?.data?.() ?? [], ctx.data.session.list()))
          .filter((session) => !sessionIDHasOpenTab(tabs.store, server, session.id))
          .filter(
            (session) => !recent().some((entry) => entry.tab.server === server && entry.tab.sessionId === session.id),
          )
          .filter((session) =>
            sessionTabTitle(session.title, language.t("session.tab.session")).toLocaleLowerCase().includes(query),
          )
          .map((session) => ({ server, session }))
      })
      .sort((a, b) => compareSessionTime(a.session, b.session))
      .slice(0, 10 - recent().length)
  })

  return (
    <Menu.Context modal={false} onOpenChange={(open) => setState({ open, query: "" })}>
      <Show
        when={props.vertical}
        fallback={
          <Tooltip placement="bottom" value={props.tooltip}>
            <Menu.Context.Trigger
              as={IconButton}
              type="button"
              variant="ghost-muted"
              size="large"
              class="shrink-0"
              icon={<Icon name="plus" />}
              onClick={props.onNewTab}
              aria-label={language.t("command.session.new")}
            />
          </Tooltip>
        }
      >
        <Menu.Context.Trigger
          as="button"
          type="button"
          data-titlebar-tab-action
          data-action="vertical-tabs-new-session"
          class="group flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] ps-1.5 pe-2 text-[13px] leading-4 text-v2-text-text-faint hover:text-v2-text-text-base"
          onClick={props.onNewTab}
          aria-label={language.t("command.session.new")}
        >
          <Icon name="edit" class="shrink-0" />
          <span class="min-w-0 truncate">{language.t("command.session.new")}</span>
          <span
            class="ms-auto hidden min-w-0 truncate text-v2-text-text-faint group-hover:block group-focus-visible:block"
            aria-hidden="true"
          >
            <bdi dir="ltr">{props.keybind}</bdi>
          </span>
        </Menu.Context.Trigger>
      </Show>
      <Menu.Context.Portal>
        <Menu.Context.Content
          class="max-h-[66.667dvh] w-56 max-w-56 overflow-hidden"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
          onFocusIn={(event) => {
            if (event.target !== event.currentTarget) return
            // The menu defers its own autofocus; redirect only container focus, not item navigation.
            queueMicrotask(() => search?.focus())
          }}
        >
          <ScrollView focusable={false}>
            <div class="recently-closed-search mx-1 mb-1" data-empty={!state.query}>
              <TextInput
                ref={search}
                type="search"
                dir="auto"
                leadingIcon={<Icon name="magnifying-glass" size="small" />}
                showClearButton
                clearIcon="circle-xmark"
                onClearClick={() => {
                  setState("query", "")
                  search?.focus()
                }}
                aria-label={language.t("session.tabs.closed.search")}
                placeholder={language.t("session.tabs.closed.search")}
                spellcheck={false}
                autocomplete="off"
                value={state.query}
                onFocusIn={(event) => event.stopPropagation()}
                onInput={(event) => setState("query", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" || event.key === "ArrowDown" || event.key === "ArrowUp") return
                  event.stopPropagation()
                }}
              />
            </div>
            <Show when={recent().length}>
              <Menu.Group>
                <Menu.GroupLabel>{language.t("home.recentlyClosed")}</Menu.GroupLabel>
                <For each={recent()}>
                  {(entry) => (
                    <RecentlyClosedTabItem
                      entry={entry}
                      onSelect={() => tabs.reopenClosedTab(entry.tab, { append: true })}
                    />
                  )}
                </For>
              </Menu.Group>
            </Show>
            <Show when={other().length}>
              <Menu.Group>
                <Menu.GroupLabel>{language.t("sidebar.project.recentSessions")}</Menu.GroupLabel>
                <For each={other()}>
                  {(item) => (
                    <RecentlyClosedTabItem
                      entry={{
                        tab: { type: "session", server: item.server, sessionId: item.session.id },
                        info: { title: item.session.title, directory: item.session.location.directory },
                      }}
                      onSelect={() => {
                        global.serverCtx(item.server)?.data.session.remember(item.session)
                        tabs.select(tabs.addSessionTab({ server: item.server, sessionId: item.session.id }))
                      }}
                    />
                  )}
                </For>
              </Menu.Group>
            </Show>
            <Show when={!recent().length && !other().length}>
              <div
                role="status"
                class="px-3 py-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-faint"
              >
                {language.t(state.query.trim() ? "session.search.noResults" : "session.tabs.closed.empty")}
              </div>
            </Show>
          </ScrollView>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function RecentlyClosedTabItem(props: { entry: Pick<ClosedTab, "tab" | "info">; onSelect: () => void }) {
  const global = useGlobal()
  const language = useLanguage()
  const [state, setState] = createStore({ truncated: false })
  const placement = language.direction() === "rtl" ? "left-start" : "right-start"

  const serverCtx = useServerCtx(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.entry.tab.server),
  )

  const session = createMemo(() => serverCtx()?.data.session.get(props.entry.tab.sessionId))
  const directory = () => props.entry.info?.directory ?? session()?.location.directory ?? ""

  const project = createMemo(() => {
    const value = session()

    if (value) return serverCtx()?.projects.forSession(value)

    if (!directory()) return

    return serverCtx()?.projects.forDirectory(directory()) ?? { worktree: directory() }
  })

  const title = () => sessionTabTitle(session()?.title ?? props.entry.info?.title, language.t("session.tab.session"))

  return (
    <Menu.Item class="max-w-56" onSelect={props.onSelect}>
      <span class="flex size-4 shrink-0 items-center justify-center">
        <SessionTabAvatarView project={project()} directory={directory()} unread={false} loading={false} />
      </span>
      <Tooltip
        placement={placement}
        value={<bdi dir="auto">{title()}</bdi>}
        disabled={!state.truncated}
        class="min-w-0 flex-1"
        contentClass="max-w-[min(480px,calc(100vw-32px))] break-words"
      >
        <span
          ref={(element) =>
            createResizeObserver(element, () => setState("truncated", element.scrollWidth > element.clientWidth))
          }
          dir="auto"
          class="block min-w-0 truncate text-start"
        >
          {title()}
        </span>
      </Tooltip>
    </Menu.Item>
  )
}
