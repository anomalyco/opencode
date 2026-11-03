import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Panel, Slot, Style, usePanel, type Plugin } from "@opencode/plugin/gui"
import type Details from "./index"
import { DetailsHeader, type DetailsMenus } from "./popover"
import { BuiltinSlot, onIdle } from "@opencode/plugin/gui/builtin"

const setup: Plugin.Setup<typeof Details> = (ctx) => {
  const sessions = ctx.sessions

  const menus: DetailsMenus = new Set()

  const DetailsPanel = lazy(() =>
    Promise.all([import("./panel"), import("./details.css?inline")]).then(([panel, css]) => {
      ctx.add(Style, css.default)

      return panel
    }),
  )

  const LocationMenu = lazy(() => import("./location-menu"))
  const LocationWorkspace = lazy(() => import("./location-workspace"))

  // Compile the panel while the app idles, so the first open renders at once.
  onCleanup(
    onIdle(() => {
      void DetailsPanel.preload()
      void LocationMenu.preload()
      void LocationWorkspace.preload()
    }),
  )

  ctx.add(Slot, {
    at: "session.header",
    order: 20,
    render: (input) => (
      <DetailsHeader menus={menus} session={input.session} active={input.active} panel={DetailsPanel} />
    ),
  })

  ctx.add(Slot, {
    at: "session.location.menu",
    render: (input) => (
      <Suspense>
        <LocationMenu session={input.session} screen={input.screen} shown={input.shown} />
      </Suspense>
    ),
  })

  ctx.add(BuiltinSlot, {
    at: "session.location.workspace",
    render: (input) => (
      <Suspense>
        <LocationWorkspace {...input} />
      </Suspense>
    ),
  })

  // The narrow-screen details drawer, offered for sessions of a project, subagents included.
  const panel: Panel = {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 50,
      kind: "drawer",
      icon: "info",
    },
    list: () => [],
    render: (props) => {
      const frame = usePanel()

      return (
        <Show when={props.session.project}>
          <Suspense>
            <DetailsPanel mobile shown={frame.visible()} session={props.session} />
          </Suspense>
        </Show>
      )
    },
  }

  ctx.add(Panel, () => {
    const session = sessions.current()

    if (!session?.project) return

    return panel
  })
}

export default setup
