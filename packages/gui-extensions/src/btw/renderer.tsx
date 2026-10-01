import { lazy, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, Layout, onIdle, Panel, Sessions, type PanelTab, type Setup } from "../sdk"
import { createBtw } from "./model"

const setup: Setup = (ctx) => {
  const SessionBtwPanel = lazy(() => import("./panel"))
  ctx.cleanup(onIdle(() => void SessionBtwPanel.preload()))
  const layout = ctx.use(Layout)
  const sessions = ctx.use(Sessions)
  const btw = createBtw(ctx)
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
      enabled: !layout.narrow() && !!sessions.current(),
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
    list: (session, open) => (open.includes("main") && btw.has(session) ? [tab] : []),
    render: (_tab, session) => (
      <Suspense>
        <SessionBtwPanel btw={btw} session={session} />
      </Suspense>
    ),
  })
}

export default setup
