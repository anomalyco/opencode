import { createSignal } from "solid-js"
import { TitlebarTabStrip } from "./titlebar-tab-strip"
import { useTabs, type Tab } from "@/context/tabs"

export default {
  title: "App/Titlebar/TabStrip",
  id: "app-titlebar-tab-strip",
}

export const ManyTabsMobileScroll = {
  render: () => {
    const tabs = useTabs()
    const tabList = tabs.store
    const [currentTab, setCurrentTab] = createSignal<Tab | undefined>(tabList[0])

    return (
      <div class="relative" style={{ width: "375px", background: "var(--v2-background-bg-deep)" }}>
        <TitlebarTabStrip
          tabs={tabList}
          currentTab={currentTab}
          forceTruncate={false}
          onNavigate={(tab) => setCurrentTab(() => tab)}
          onClose={() => {}}
          onReorder={() => {}}
          onOverflowChange={() => {}}
        />
      </div>
    )
  },
}
