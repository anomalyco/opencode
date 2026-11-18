import { createMediaQuery } from "@solid-primitives/media"
import { usePlatform } from "@/runtime/platform/platform"
import { useSettings } from "@/settings/model"

export function useProjectNavigation() {
  const platform = usePlatform()

  if (platform.platform !== "desktop") return () => false

  const settings = useSettings()

  const mobile = createMediaQuery("(max-width: 767px)")

  return () => {
    // The navigation prototype keeps Home in the sidebar.
    if (mobile() || settings.appearance.tabLayout() !== "vertical" || settings.appearance.navigationPrototype())
      return false
    const mode = settings.general.sidebarOrganize()

    return mode === "projects" || mode === "customize"
  }
}
