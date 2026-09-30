import type { MenuItemConstructorOptions } from "electron"
import { nativeCost, nativeT } from "./translations"
import { traySessionGroup, type TraySession, type TraySessions } from "./tray-sessions"
import type { TrayActionIcon } from "./tray-icon-art"
import { TRAY_LABEL_WIDTH, trayLabel, trayLabelWidth } from "./tray-label"

type TrayMenuIcons = {
  action: (action: TrayActionIcon) => MenuItemConstructorOptions["icon"]
  session: (session: TraySession, twoLines: boolean) => MenuItemConstructorOptions["icon"]
  spacer: () => MenuItemConstructorOptions["icon"]
}

export type TrayActions = {
  open: () => void
  trigger: (id: string) => void
  docs: () => void
  quit: () => void
  session: (id: string) => void
}

export function trayMenu(
  actions: TrayActions,
  snapshot: TraySessions,
  icons?: TrayMenuIcons,
  sublabels = true,
  platform: NodeJS.Platform = process.platform,
) {
  // Windows popup menus do not respond to accelerators, so showing them would advertise shortcuts that do nothing.
  const accelerator = (key: string) => (platform === "win32" ? {} : { accelerator: key })
  const items = snapshot.sessions.flatMap((session, index) => {
    const group = traySessionGroup(session.status)
    const previous = snapshot.sessions[index - 1]
    const project = session.directory.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? session.directory
    const context =
      session.context !== undefined
        ? nativeT("desktop.tray.context.percent", { percent: session.context })
        : session.tokens !== undefined
          ? nativeT("desktop.tray.context.tokens", { tokens: session.tokens })
          : nativeT("desktop.tray.context.unknown")
    const cost = nativeCost(session.cost)
    const placement = !session.placement
      ? nativeT("desktop.tray.tooltip.placementUnknown")
      : session.placement.type === "local"
        ? nativeT("desktop.tray.tooltip.local")
        : nativeT("desktop.tray.tooltip.worktree", {
            name:
              session.placement.directory.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ??
              session.placement.directory,
          })
    const remaining =
      TRAY_LABEL_WIDTH - trayLabelWidth(nativeT("desktop.tray.session.detail", { project: "", context, cost }))
    const detail = nativeT("desktop.tray.session.detail", {
      project: trayLabel(project, remaining),
      context,
      cost,
    })
    return [
      ...(!previous || traySessionGroup(previous.status) !== group
        ? [{ label: nativeT(`desktop.tray.group.${group}`), enabled: false }]
        : []),
      {
        id: `session:${session.id}`,
        icon: icons?.session(session, sublabels),
        label: trayLabel(session.title ?? "") || nativeT("desktop.tray.untitled"),
        sublabel: sublabels ? detail : undefined,
        toolTip: [
          session.title,
          placement,
          session.directory,
          session.detail,
          session.model,
          context,
          nativeT("desktop.tray.tooltip.cost", { cost }),
        ]
          .filter(Boolean)
          .join("\n"),
        click: () => actions.session(session.id),
      },
      // macOS sublabels belong to the same native item, including its hover
      // highlight and click target. Retain detail rows on platforms without them.
      ...(sublabels ? [] : [{ label: detail, icon: icons?.spacer(), enabled: false }]),
    ]
  })
  return [
    ...(snapshot.state !== "ready" ? [{ label: nativeT(`desktop.tray.${snapshot.state}`), enabled: false }] : []),
    ...(snapshot.state === "offline" && snapshot.sessions.length
      ? [{ label: nativeT("desktop.tray.stale"), enabled: false }]
      : []),
    ...items,
    ...(snapshot.state === "ready" && !items.length ? [{ label: nativeT("desktop.tray.empty"), enabled: false }] : []),
    ...(snapshot.more ? [{ label: nativeT("desktop.tray.more"), click: actions.open }] : []),
    { type: "separator" },
    {
      label: nativeT("desktop.tray.newAgent"),
      icon: icons?.action("newAgent"),
      ...accelerator("CommandOrControl+N"),
      click: () => actions.trigger("tab.new"),
    },
    {
      label: nativeT("desktop.menu.settings"),
      icon: icons?.action("settings"),
      ...accelerator("CommandOrControl+,"),
      click: () => actions.trigger("settings.open"),
    },
    { label: nativeT("desktop.tray.docs"), icon: icons?.action("docs"), click: actions.docs },
    { type: "separator" },
    {
      label: nativeT("desktop.tray.quit"),
      icon: icons?.action("quit"),
      ...accelerator("CommandOrControl+Q"),
      click: actions.quit,
    },
  ] satisfies MenuItemConstructorOptions[]
}
