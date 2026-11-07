import { lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Command, MenuItem, Panel, Style, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type Media from "./index"
import styles from "./media.css?inline"

const TAB = "main"

/** The session's Media panel: the images, videos and links the user and the agent shared. */
const setup: Plugin.Setup<typeof Media> = (ctx) => {
  const layout = ctx.layout
  const sessions = ctx.sessions
  const key = `${ctx.id}:${TAB}`
  const MediaPanel = lazy(() => import("./panel"))

  onCleanup(
    onIdle(() => {
      const session = sessions.current()

      if (session) void MediaPanel.preload()
    }),
  )

  ctx.add(Style, styles)

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="outline-photo" size="small" />
        <span>{tab.title}</span>
      </div>
    ),
  }

  ctx.add(Panel, {
    id: TAB,
    region: "side",
    list: (input) => (input.open.includes(TAB) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <MediaPanel session={props.session} />
      </Suspense>
    ),
  })

  const available = () => {
    const session = sessions.current()

    return !!session && !layout.narrow()
  }

  const show = () => {
    const session = sessions.current()

    if (session && available()) layout.open(key, session, { tab: "select" })
  }

  ctx.add(Command, (): Command | undefined =>
    available()
      ? { id: "open", title: ctx.t("command.open"), group: ctx.t("command.category.view"), editable: true, run: show }
      : undefined,
  )

  ctx.add(MenuItem, (): MenuItem | undefined => {
    const session = sessions.current()

    if (!session || !available()) return undefined

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("tab.title"),
      opened: layout.state(key, session) !== "closed",
      icon: "outline-photo",
      keybind: "media.open",
      order: 40,
      run: show,
    }
  })
}

export default setup
