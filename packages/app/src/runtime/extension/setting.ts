import { createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Setting } from "@opencode/gui-extensions/sdk"
import { usePlatform } from "@/runtime/platform/platform"
import { useExtensionHost } from "./host"

export type SettingItem = ReturnType<ReturnType<typeof createExtensionSettings>["items"]>[number]

/** Extension settings that apply to this platform and viewport. */
export function createExtensionSettings() {
  const host = useExtensionHost()
  const platform = usePlatform()
  const mobile = createMediaQuery("(max-width: 767px)")
  const items = createMemo(() =>
    host.items(Setting).filter((item) => {
      if (item.value.available === "desktop") return platform.platform === "desktop"
      if (item.value.available === "mobile") return mobile()
      return true
    }),
  )
  const pages = createMemo(() => items().filter((item) => !item.value.page))
  const tabs = createMemo<ReadonlySet<string>>(() => new Set(pages().map((item) => item.value.id)))
  return {
    items,
    /** Settings without a host page, in contribution order. */
    pages,
    /** Their tab values. */
    tabs,
    sections: (page: "general" | "servers") => items().filter((item) => item.value.page === page),
  }
}
