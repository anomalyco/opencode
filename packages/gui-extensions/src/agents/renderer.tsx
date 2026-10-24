import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { MenuItem, onIdle, Panel, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import type definition from "./index"
import { AgentsTabIcon, SessionAgentsIndicator } from "./indicator"

const setup: Setup<typeof definition> = (ctx) => {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const SessionAgentsPanel = lazy(() => import("./panel"))
  // Compile the panel while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionAgentsPanel.preload()))

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger.
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    label: (state) => (
      <div class="flex items-center gap-1.5">
        <AgentsTabIcon session={state.session} />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
    draggable: false,
    closable: "compact",
  }

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open",
    get title() {
      return ctx.t("tab.title")
    },
    icon: "bullet-list",
    order: 15,
    run() {
      const session = sessions.current()

      if (!session) return
      layout.open("agents:main", session)
    },
  })

  ctx.add(Slot, {
    at: "session.header",
    order: 15,
    render: (input) => <SessionAgentsIndicator session={input.session} placement="bottom" />,
  })

  ctx.add(
    Panel,
    (): Panel => ({
      id: "main",
      region: "side",
      mobile: { title: ctx.t("mobile.title"), order: 30, kind: "menu", icon: "bullet-list" },
      list: (input) => (input.open.includes("main") ? [tab] : []),
      render: (props) => {
        const panel = usePanel()

        return (
          <Show
            when={panel.placement() !== "mobile"}
            fallback={
              <Suspense>
                <SessionAgentsPanel session={props.session} />
              </Suspense>
            }
          >
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <Suspense>
                <SessionAgentsPanel session={props.session} />
              </Suspense>
            </div>
          </Show>
        )
      },
    }),
  )
}

export default setup
