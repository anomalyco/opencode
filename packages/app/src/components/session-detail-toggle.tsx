import { createMemo } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionDetailToggle() {
  const layout = useLayout()
  const language = useLanguage()
  const { tabs, view } = useSessionLayout()

  const isActive = createMemo(() => tabs().active() === "detail")

  const toggle = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
    if (layout.fileTree.opened() && layout.fileTree.tab() !== "all") layout.fileTree.setTab("all")

    if (isActive()) {
      tabs().close("detail")
    } else {
      tabs().open("detail")
      tabs().setActive("detail")
    }
  }

  return (
    <Tooltip placement="bottom" value={language.t("session.tab.detail")}>
      <IconButton
        icon="sidebar"
        variant="ghost"
        class="size-6 rounded-md"
        classList={{
          "bg-surface-base-active": isActive(),
        }}
        onClick={toggle}
        aria-label={language.t("session.tab.detail")}
        aria-pressed={isActive()}
      />
    </Tooltip>
  )
}
