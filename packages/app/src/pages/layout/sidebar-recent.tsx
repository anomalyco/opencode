import { createEffect, createMemo, For, on, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type GlobalSession, type Session } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { organizeRecentSessions } from "@/utils/recent-session"
import { SessionItem, SessionSkeleton, type SessionItemProps } from "./sidebar-items"

const LIMIT = 20

async function query(
  client: ReturnType<typeof useGlobalSDK>["client"],
  opts: { search?: string; cursor?: number; limit?: number },
) {
  const result = await client.experimental.session
    .list({
      limit: opts.limit ?? LIMIT,
      search: opts.search,
      cursor: opts.cursor,
    })
    .catch(() => undefined)
  const next = result?.response.headers.get("x-next-cursor")
  return { items: result?.data ?? [], next: next ? Number(next) : undefined }
}

export const RecentTile = (props: {
  selected: Accessor<boolean>
  onClick: () => void
}): JSX.Element => {
  const language = useLanguage()
  return (
    <Tooltip placement="right" value={language.t("sidebar.project.recentSessions")}>
      <button
        type="button"
        aria-label={language.t("sidebar.project.recentSessions")}
        classList={{
          "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default":
            true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": props.selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !props.selected(),
        }}
        onClick={props.onClick}
      >
        <div class="size-8 rounded flex items-center justify-center bg-surface-base-hover">
          <Icon name="status" class="text-icon-base" />
        </div>
      </button>
    </Tooltip>
  )
}

export const RecentSidebarPanel = (props: {
  mobile?: boolean
  merged?: boolean
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "children" | "mobile" | "dense" | "popover">
  sidebarWidth: Accessor<number>
  sidebarOpened: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
}): JSX.Element => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const merged = createMemo(() => props.mobile || (props.merged ?? props.sidebarOpened()))
  const hover = createMemo(() => !props.mobile && props.merged === false && !props.sidebarOpened())

  const [store, setStore] = createStore({
    sessions: [] as GlobalSession[],
    loading: true,
    cursor: undefined as number | undefined,
    search: "",
    booted: false,
  })

  const data = createMemo(() => organizeRecentSessions(store.sessions))

  const load = async (reset?: boolean) => {
    setStore("loading", true)
    const result = await query(globalSDK.client, {
      search: store.search || undefined,
      cursor: reset ? undefined : store.cursor,
      limit: LIMIT,
    })
    if (reset) {
      setStore("sessions", result.items)
    } else {
      setStore("sessions", (prev) => [...prev, ...result.items])
    }
    setStore("cursor", result.next)
    setStore("loading", false)
    setStore("booted", true)
  }

  createEffect(
    on(
      () => store.search,
      () => load(true),
    ),
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const onSearch = (val: string) => {
    clearTimeout(timer)
    timer = setTimeout(() => setStore("search", val), 300)
  }

  const slug = (_session: GlobalSession) => "recent"
  const archiveSession = async (session: Session) => {
    await props.sessionProps.archiveSession(session)

    const drop = new Set<string>()
    const walk = (id: string) => {
      if (drop.has(id)) return
      drop.add(id)
      for (const child of data().children.get(id) ?? []) {
        walk(child)
      }
    }

    walk(session.id)
    setStore("sessions", (prev) => prev.filter((item) => !drop.has(item.id)))
    void load(true)
  }

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": props.mobile,
        "max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : `${Math.max(Math.max(props.sidebarWidth(), 244) - 64, 0)}px`,
      }}
    >
      <div class="shrink-0 pl-1 py-1">
        <div class="flex items-start justify-between gap-2 py-2 pl-2 pr-0">
          <div class="flex flex-col min-w-0">
            <span class="text-14-medium text-text-strong truncate">
              {language.t("sidebar.project.recentSessions")}
            </span>
            <span class="text-12-regular text-text-base truncate">{language.t("sidebar.recent.description")}</span>
          </div>
        </div>
      </div>

      <div class="shrink-0 px-1 pb-2">
        <input
          type="text"
          placeholder={`${language.t("common.search")}...`}
          class="w-full px-3 py-1.5 text-14-regular bg-transparent border border-border rounded-md text-text-strong placeholder:text-text-weak focus:outline-none focus:border-text-weak"
          onInput={(e) => onSearch(e.currentTarget.value)}
        />
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar [overflow-anchor:none] py-2">
        <Show when={store.loading && !store.booted}>
          <SessionSkeleton />
        </Show>

        <Show when={store.booted && data().sections.length === 0 && !store.loading}>
          <div class="flex items-center justify-center py-8 text-text-weak text-14-regular">
            {language.t("common.noResults")}
          </div>
        </Show>

        <nav class="flex flex-col gap-4">
          <For each={data().sections}>
            {(group) => (
              <section class="flex flex-col gap-1">
                <div class="px-2 pt-1 pb-1 text-[11px] leading-4 text-text-weak uppercase tracking-[0.08em]">
                  {group.label}
                </div>
                <For each={group.items}>
                  {(session) => (
                    <SessionItem
                      {...props.sessionProps}
                      session={session}
                      list={store.sessions}
                      slug={slug(session)}
                      mobile={props.mobile}
                      archiveSession={archiveSession}
                    />
                  )}
                </For>
              </section>
            )}
          </For>

          <Show when={store.cursor !== undefined && !store.loading}>
            <div class="relative w-full py-1">
              <Button
                variant="ghost"
                class="flex w-full text-left justify-start text-14-regular text-text-weak pl-9 pr-10"
                size="large"
                onClick={(e: MouseEvent) => {
                  load()
                  ;(e.currentTarget as HTMLButtonElement).blur()
                }}
              >
                {language.t("common.loadMore")}
              </Button>
            </div>
          </Show>
        </nav>
      </div>
    </div>
  )
}
