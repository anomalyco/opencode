import { createEffect, on, type Accessor } from "solid-js"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { useSettings } from "@/settings/model"
import { tabKey, useTabs, type Tab } from "./tabs"

const ListSnapshot = Persistence.struct({
  /** The tabs open when List was turned on, by tab key; empty while Tabs is in use. */
  keys: Persistence.array(Schema.String),
  sessions: Persistence.array(Persistence.struct({ server: Schema.String, sessionId: Schema.String })),
})

/**
 * The navigation prototype's switch between Tabs and List. List still opens each session in a tab, so turning it on
 * remembers the tabs you had; turning it off closes the tabs List opened and brings back any of yours that closed,
 * keeping the session you're on either way.
 */
export function createNavigationSwitch(currentTab: Accessor<Tab | undefined>) {
  const settings = useSettings()
  const tabs = useTabs()

  const [snapshot, setSnapshot, , ready] = persisted(Persist.global("navigation.list-snapshot"), ListSnapshot, {
    keys: [],
    sessions: [],
  })

  createEffect(
    on(
      () => ready() && settings.ready() && settings.appearance.navigation(),
      (navigation, previous) => {
        if (!navigation) return

        if (navigation === "list") {
          // Restarting in List keeps the snapshot taken when it was turned on.
          if (!previous && snapshot.keys.length > 0) return

          if (previous === "list") return
          setSnapshot({
            keys: tabs.store.map(tabKey),
            sessions: tabs.store.flatMap((tab) =>
              tab.type === "session" ? [{ server: tab.server, sessionId: tab.sessionId }] : [],
            ),
          })

          return
        }

        if (previous !== "list" || snapshot.keys.length === 0) return
        restore()
      },
    ),
  )

  function restore() {
    const kept = new Set(snapshot.keys)
    const current = currentTab()
    const currentKey = current ? tabKey(current) : undefined

    const open = new Set(tabs.store.map(tabKey))

    snapshot.sessions.forEach((session) => {
      const tab = { server: ServerConnection.Key.make(session.server), sessionId: session.sessionId }

      if (!open.has(tabKey({ type: "session", ...tab }))) tabs.addSessionTab(tab)
    })

    const opened = tabs.store.map(tabKey).filter((key) => !kept.has(key) && key !== currentKey)
    const keep = current ?? tabs.store.find((tab) => kept.has(tabKey(tab)))

    if (opened.length > 0 && keep) tabs.closeTabs(opened, keep)
    setSnapshot({ keys: [], sessions: [] })
  }
}
