import { createMemo } from "solid-js"
import { MenuItem } from "@opencode/plugin/gui"
import { usePluginHost } from "./host"

/** The side region's + menu: every plugin's `session.panel` item, in order. */
export function createSessionPanelMenu() {
  const host = usePluginHost()

  return createMemo(() =>
    host
      .list(MenuItem)
      .flatMap((item) => (item.menu === "session.panel" ? [item] : []))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )
}
