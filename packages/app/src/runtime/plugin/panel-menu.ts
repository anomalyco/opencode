import { createMemo } from "solid-js"
import { MenuItem, type SessionPanelMenuItem } from "@opencode/plugin/gui"
import { usePluginHost } from "./host"

export type SessionPanelMenuEntry = {
  readonly key: string
  readonly item: SessionPanelMenuItem
}

/** The side region's + menu entries, keyed by `${plugin}:${id}` in display order. */
export function createSessionPanelMenuEntries() {
  const host = usePluginHost()

  return createMemo(() =>
    host
      .items(MenuItem)
      .flatMap((entry): SessionPanelMenuEntry[] =>
        entry.value.menu === "session.panel" ? [{ key: `${entry.plugin}:${entry.value.id}`, item: entry.value }] : [],
      )
      .toSorted((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0)),
  )
}

/** The side region's + menu: every plugin's `session.panel` item, in order. */
export function createSessionPanelMenu() {
  const entries = createSessionPanelMenuEntries()

  return createMemo(() => entries().map((entry) => entry.item))
}
