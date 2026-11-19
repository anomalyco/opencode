import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, MenuItem, type PanelTab, type Plugin, Slot } from "@opencode/plugin/gui"
import { BuiltinPanel, onIdle } from "@opencode/plugin/gui/builtin"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import type Outline from "./index"

const setup: Plugin.Setup<typeof Outline> = (ctx) => {
  const SessionOutlinePanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionOutlinePanel.preload()))

  const key = `${ctx.id}:main`
  const current = () => ctx.sessions.current()
  const open = () => {
    const session = current()
    if (session) ctx.layout.open(key, session, { tab: "select" })
  }
  const toggle = () => {
    const session = current()
    if (session) ctx.layout.toggle(key, session)
  }

  const tab: PanelTab = {
    id: "main",
    title: ctx.t("outline.title"),
    label: () => <Icon name="bullet-list" />,
    closable: "compact",
  }

  ctx.add(BuiltinPanel, {
    id: "main",
    region: "side",
    width: 300,
    mobile: {
      title: ctx.t("outline.title"),
      order: 60,
      kind: "menu",
      icon: "bullet-list",
    },
    list: (input) => (input.open.includes("main") ? [tab] : []),
    render: (input) => (
      <Suspense>
        <SessionOutlinePanel session={input.session} screen={input.screen} />
      </Suspense>
    ),
  })

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("outline.command.open"),
    description: ctx.t("outline.command.description"),
    group: ctx.t("outline.title"),
    section: "navigation",
    bind: "mod+alt+o",
    suggested: true,
    enabled: !!current(),
    run: () => open(),
  }))

  ctx.add(MenuItem, () => {
    const session = current()
    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("outline.menu.open"),
      icon: "bullet-list",
      order: 40,
      opened: !!session && ctx.layout.state(key, session) !== "closed",
      run: () => open(),
    }
  })

  ctx.add(Slot, {
    at: "session.header",
    order: 60,
    render: () => (
      <Tooltip value={ctx.t("outline.header.button")} placement="bottom">
        <IconButton
          size="normal"
          variant="ghost-muted"
          icon={<Icon name="bullet-list" />}
          aria-label={ctx.t("outline.header.button")}
          onClick={toggle}
        />
      </Tooltip>
    ),
  })
}

export default setup
