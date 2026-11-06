import { lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { ConfigEntry } from "@opencode/client/promise"
import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Style,
  type MountedSession,
  type PanelTab,
  type Plugin,
} from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type Media from "./index"
import styles from "./media.css?inline"

const TAB = "main"

/**
 * The session's Media panel: the images, videos, files and links the user and the agent shared, behind the
 * `session_media` feature flag of the session's directory. Turning the flag off stops listing the tab, which closes it.
 */
const setup: Plugin.Setup<typeof Media> = (ctx) => {
  const layout = ctx.layout
  const sessions = ctx.sessions
  const key = `${ctx.id}:${TAB}`
  const MediaPanel = lazy(() => import("./panel"))

  onCleanup(
    onIdle(() => {
      const session = sessions.current()

      if (session && enabled(session)) void MediaPanel.preload()
    }),
  )

  ctx.add(Style, styles)

  // The flag lives in the session directory's config, which only some screens load; the panel needs it on every one.
  createKeyed(
    () => {
      const session = sessions.current()

      return session && { server: session.server, directory: session.directory, connected: session.server.connected }
    },
    (current) => {
      if (current?.connected)
        void current.server.data.location.config.sync({ directory: current.directory }).catch(() => {})
    },
    {
      equals: (previous, next) =>
        previous?.server === next?.server &&
        previous?.directory === next?.directory &&
        previous?.connected === next?.connected,
    },
  )

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
    list: (input) => (input.open.includes(TAB) && enabled(input.session) ? [tab] : []),
    render: (props) => (
      <Suspense>
        <MediaPanel session={props.session} />
      </Suspense>
    ),
  })

  const available = () => {
    const session = sessions.current()

    return !!session && !layout.narrow() && enabled(session)
  }

  const show = () => {
    const session = sessions.current()

    if (session && available()) layout.open(key, session, { tab: "select" })
  }

  // Listed only while the flag is on, so a release build never offers it.
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

/**
 * Whether `session_media` is on where the session lives, as Core's `Flag.resolve` decides it from config: the
 * highest-priority document that sets `experimental` names it, else `all_flags`, else it is on in local and dev
 * builds. `OPENCODE_FLAGS` only reaches the server, so the app cannot see it.
 */
function enabled(session: MountedSession) {
  const entries = session.server.data.location.config.list({ directory: session.directory }) ?? []
  const configured = latest(entries, () => true)?.session_media

  if (configured !== undefined) return configured

  if (latest(entries, (experimental) => experimental.all_flags !== undefined)?.all_flags === true) return true

  return import.meta.env.DEV || ["local", "dev"].includes(import.meta.env.VITE_OPENCODE_CHANNEL ?? "")
}

type Experimental = NonNullable<Extract<ConfigEntry, { type: "document" }>["info"]["experimental"]>

function latest(entries: readonly ConfigEntry[], match: (experimental: Experimental) => boolean) {
  return entries
    .flatMap((entry) => (entry.type === "document" && entry.info.experimental ? [entry.info.experimental] : []))
    .findLast(match)
}

export default setup
