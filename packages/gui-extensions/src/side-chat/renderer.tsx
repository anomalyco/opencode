import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, createKeyed, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type SideChat from "./index"
import { createSideChat } from "./model"

const setup: Setup<typeof SideChat> = (ctx) => {
  const SideChatPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SideChatPanel.preload()))
  const layout = ctx.layout
  const sessions = ctx.sessions
  const chats = createSideChat(ctx)
  // Changes when a session mounts or unmounts, not on every switch between sessions.
  const mounted = createMemo(() => !!sessions.current())

  // Tab objects per session, reused so strip updates and session switches do not rebuild a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  // Drops the tab objects of sessions whose shell tab closed.
  createKeyed(
    () => [...sessions.list().map((session) => session.key), sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set([...sessions.list().map((session) => session.key), sessions.current()?.key])
      tabs.forEach((_cache, key) => {
        if (!keep.has(key)) tabs.delete(key)
      })
    },
  )

  ctx.add(
    Command,
    (): Command => ({
      id: "new",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      bind: "mod+shift+n",
      // Offered only while a session is open in a desktop-width window.
      enabled: !layout.narrow() && mounted(),
      run: () => void chats.start(),
    }),
  )

  ctx.add(Panel, {
    id: "main",
    region: "side",
    transient: true,
    // One tab per stored chat. Until the session's store loads, its tabs stay listed but hidden so restore keeps them;
    // afterwards a tab without a stored chat leaves the strip.
    list: (input) => {
      if (input.open.length === 0) return []

      const saved = chats.saved(input.session)
      const cache = tabs.get(input.session.key) ?? new Map<string, PanelTab>()
      tabs.set(input.session.key, cache)

      return input.open.flatMap((id) => {
        if (saved.ready() && !saved.value?.chats.some((item) => item.id === id)) return []

        const existing = cache.get(id)

        if (existing) return [existing]

        const title = () => ctx.t("tab.title", { number: chats.entry(input.session, id)?.ordinal ?? 1 })

        const tab: PanelTab = {
          id,
          get title() {
            return title()
          },
          get hidden() {
            return !saved.ready()
          },
          label: () => (
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name="speech-bubble" size="small" />
              <span class="truncate">{title()}</span>
            </div>
          ),
        }

        cache.set(id, tab)

        return [tab]
      })
    },
    render: (props) => (
      <Suspense>
        <SideChatPanel chats={chats} session={props.session} id={props.tab.id} />
      </Suspense>
    ),
    close: (input) => {
      chats.remove(input.session, input.tab.id)
      tabs.get(input.session.key)?.delete(input.tab.id)
    },
  })
}

export default setup
