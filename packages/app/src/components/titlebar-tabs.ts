import { mapArray } from "solid-js"
import type { Accessor } from "solid-js"

export type TitlebarTab = { dir: string; sessionId: string; href: string }

export function createTitlebarTabsEnriched<T extends { title: string }>(
  tabsStore: TitlebarTab[],
  sessionForTab: (tab: TitlebarTab) => Accessor<T | undefined>,
) {
  const base = mapArray(
    () => tabsStore,
    (tab) => {
      const info = sessionForTab(tab)
      return { ...tab, info, title: () => info()?.title }
    },
  )

  return () => base().filter((tab) => tab.info())
}
