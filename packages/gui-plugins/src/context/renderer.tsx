import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Slot, usePanel, type Plugin } from "@opencode/plugin/gui"
import { BuiltinPanel, onIdle, type BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import type definition from "./index"
import { SessionContextUsage } from "./indicator"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const SessionContextTab = lazy(() => import("./tab"))
  // Compile the tab while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionContextTab.preload()))

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger; the label
  // reads the routed session from its state.
  const tab: BuiltinPanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    draggable: false,
    first: true,
    fallback: true,
    label: (state) => (
      <div class="flex items-center gap-2">
        <SessionContextUsage session={state.session} variant="indicator" />
        <div>{ctx.t("tab.title")}</div>
      </div>
    ),
  }

  ctx.add(Slot, {
    at: "session.header",
    order: 10,
    render: (input) => (
      <SessionContextUsage session={input.session} active={input.active} placement="bottom" compact={input.compact} />
    ),
  })

  ctx.add(
    BuiltinPanel,
    (): BuiltinPanel => ({
      id: "main",
      region: "side",
      // Stored before plugins as "context".
      legacy: { context: "main" },
      mobile: { title: ctx.t("mobile.title"), order: 40, kind: "menu", icon: "status" },
      list: (input) => (input.open.includes("main") ? [tab] : []),
      closed: () => ({ icon: "status" }),
      render: (props) => {
        const panel = usePanel()

        return (
          <Show
            when={panel.placement() !== "mobile"}
            fallback={
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            }
          >
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            </div>
          </Show>
        )
      },
    }),
  )
}

export default setup
