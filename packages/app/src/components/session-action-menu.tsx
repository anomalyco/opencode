import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"

export function SessionActionMenu(props: {
  trigger: JSX.Element
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus?: () => boolean
  shareEnabled: boolean
  onRename: () => void
  onShare: () => void
  onExport: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  return (
    <MenuV2
      gutter={6}
      placement="bottom-end"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      {props.trigger}
      <MenuV2.Portal>
        <MenuV2.Content
          style={{ width: "120px", "min-width": "120px" }}
          onCloseAutoFocus={(event) => {
            if (props.onCloseAutoFocus?.()) event.preventDefault()
          }}
        >
          <MenuV2.Item onSelect={props.onRename}>{language.t("common.rename")}</MenuV2.Item>
          <Show when={props.shareEnabled}>
            <MenuV2.Item onSelect={props.onShare}>{language.t("session.share.action.share")}...</MenuV2.Item>
          </Show>
          <MenuV2.Item onSelect={props.onExport}>{language.t("common.export")}...</MenuV2.Item>
          <MenuV2.Item onSelect={props.onArchive}>{language.t("common.archive")}</MenuV2.Item>
          <MenuV2.Separator />
          <MenuV2.Item onSelect={props.onDelete}>{language.t("common.delete")}...</MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
