import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, onIdle, Panel, type PanelTab, type Setup } from "../sdk"
import type Btw from "./index"
import { createBtw } from "./model"

const setup: Setup<typeof Btw> = (ctx) => {
  const SessionBtwPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionBtwPanel.preload()))
  const layout = ctx.layout
  const sessions = ctx.sessions
  const btw = createBtw(ctx)
  // Changes when a session mounts or unmounts, not on every switch between sessions.
  const mounted = createMemo(() => !!sessions.current())

  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="bubble-5" size="small" />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "ask",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      slash: { name: "btw", arguments: true },
      hidden: true,
      // Offered only while a session is open in a desktop-width window.
      enabled: !layout.narrow() && mounted(),
      run: (input) => btw.ask(input),
    }),
  )

  ctx.add(Panel, {
    id: "main",
    region: "side",
    transient: true,
    // Layouts saved before extensions store the tab as "btw"; as a panel key it leaves like any unlisted transient tab.
    legacy: { btw: "main" },
    // The answer lives only in this window's memory, so the tab lists while its session has one.
    list: (input) => (input.open.includes("main") && btw.has(input.session) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <SessionBtwPanel btw={btw} session={props.session} />
      </Suspense>
    ),
  })
}

export default setup
