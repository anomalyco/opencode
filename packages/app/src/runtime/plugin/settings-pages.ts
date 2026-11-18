import { createMemo } from "solid-js"
import { SettingsPage } from "@opencode/plugin/gui"
import { usePluginHost } from "./host"

/** The settings pages plugins contribute. */
export function createSettingsPages() {
  const host = usePluginHost()
  const items = createMemo(() => host.items(SettingsPage))

  const pages = createMemo(() => items().filter((item) => !item.value.page))
  const tabs = createMemo<ReadonlySet<string>>(() => new Set(pages().map((item) => item.value.id)))

  return {
    items,
    /** Settings pages without a host page, in contribution order. */
    pages,
    /** Their tab values. */
    tabs,
    /** Sections on a host page, or with `section`, the rows placed in that host section. */
    sections: (page: "general" | "servers", section?: "general") =>
      items().filter((item) => item.value.page === page && item.value.section === section),
  }
}
