import { createMemo, lazy, onCleanup, Show, Suspense } from "solid-js"
import { turnMessages, turnSources } from "@opencode/session-ui/sources"
import { sourcesExperiment } from "@opencode/session-ui/sources/experiment"
import { SourcesTitle } from "@opencode/session-ui/sources/title"
import { createKeyed, LinkHandler, Panel, type MountedSession, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import type Sources from "./index"
import { onIdle } from "@opencode/plugin/gui/builtin"

/**
 * The Sources experiment's side panel: one transient tab per turn, keyed by the user message that opened it. The
 * timeline's sources chip opens it with a link whose origin is this plugin and whose href is that message's ID.
 * Turning the experiment off stops listing the tabs, which closes them.
 */
const setup: Plugin.Setup<typeof Sources> = (ctx) => {
  const SourcesTab = lazy(() => import("./panel"))
  onCleanup(
    onIdle(() => {
      if (sourcesExperiment.enabled) void SourcesTab.preload()
    }),
  )

  // Tab objects per session, reused so strip updates and session switches do not rebuild a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  // Drops the tab objects of sessions whose shell tab closed.
  createKeyed(
    () => [...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set([...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key])
      tabs.forEach((_cache, key) => {
        if (!keep.has(key)) tabs.delete(key)
      })
    },
  )

  const count = (session: MountedSession, id: string) =>
    turnSources(turnMessages(session.server.data.session.message.list(session.id), id)).sources.length

  ctx.add(LinkHandler, {
    match: (link) => sourcesExperiment.enabled && link.origin === ctx.id && !!link.session,
    open(link) {
      if (link.session) ctx.layout.open(`${ctx.id}:${link.href}`, link.session, { tab: "select" })
    },
  })

  ctx.add(Panel, {
    id: "turn",
    region: "side",
    transient: true,
    list: (input) => {
      if (!sourcesExperiment.enabled) {
        tabs.delete(input.session.key)

        return []
      }

      const cache = tabs.get(input.session.key) ?? new Map<string, PanelTab>()
      tabs.set(input.session.key, cache)

      return input.open.map((id) => {
        const existing = cache.get(id)

        if (existing) return existing

        const tab: PanelTab = {
          id,
          get title() {
            return ctx.t("tab.count", { count: count(input.session, id) })
          },
          label: (state) => {
            const total = createMemo(() => count(state.session, id))

            return <SourcesTitle count={total()} />
          },
        }

        cache.set(id, tab)

        return tab
      })
    },
    render: (props) => (
      <Show when={sourcesExperiment.enabled}>
        <Suspense>
          <SourcesTab session={props.session} from={props.tab.id} />
        </Suspense>
      </Show>
    ),
    close: (input) => {
      tabs.get(input.session.key)?.delete(input.tab.id)
    },
  })
}

export default setup
