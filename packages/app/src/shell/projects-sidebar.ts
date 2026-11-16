import { createMediaQuery } from "@solid-primitives/media"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettings } from "@/settings/model"

export function useProjectsSidebar() {
  const platform = usePlatform()

  if (platform.platform !== "desktop") return () => false

  const settings = useSettings()

  const mobile = createMediaQuery("(max-width: 767px)")

  return () =>
    !mobile() && settings.appearance.tabLayout() === "vertical" && settings.general.sidebarOrganize() === "projects"
}
