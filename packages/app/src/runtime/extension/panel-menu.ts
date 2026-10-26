import { createMemo } from "solid-js"
import { MenuItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/** The side region's + menu: every extension's `session.panel` item, in order. */
export function createSessionPanelMenu() {
  const host = useExtensionHost()

  return createMemo(() =>
    host
      .list(MenuItem)
      .flatMap((item) => (item.menu === "session.panel" ? [item] : []))
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )
}
