import { createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { SettingsPage } from "@opencode/gui-extensions/sdk"
import { usePlatform } from "@/runtime/platform/platform"
import { useExtensionHost } from "./host"

export type SettingsPageItem = ReturnType<ReturnType<typeof createSettingsPages>["items"]>[number]

/** Extension settings pages that apply to this platform and viewport. */
export function createSettingsPages() {
  const host = useExtensionHost()
  const platform = usePlatform()
  const mobile = createMediaQuery("(max-width: 767px)")

  const items = createMemo(() =>
    host.items(SettingsPage).filter((item) => {
      if (item.value.available === "desktop") return platform.platform === "desktop"

      if (item.value.available === "mobile") return mobile()

      return true
    }),
  )

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
