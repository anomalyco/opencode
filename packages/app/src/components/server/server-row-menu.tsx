import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { type Component, Show } from "solid-js"
import { useServerManagementController } from "@/components/dialog-select-server"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"

export const ServerRowMenu: Component<{
  server: ServerConnection.Any
  controller: ReturnType<typeof useServerManagementController>
  onEdit: (server: ServerConnection.Http) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const key = ServerConnection.key(props.server)
  const builtin = ServerConnection.builtin(props.server)
  const isDefault = () => props.controller.defaultKey() === key

  return (
    <MenuV2 gutter={6} modal={false} placement="bottom-end" open={props.open} onOpenChange={props.onOpenChange}>
      <MenuV2.Trigger
        as={IconButtonV2}
        variant="ghost-muted"
        size="small"
        icon={<IconV2 name="outline-dots" />}
        aria-label={language.t("common.moreOptions")}
      />
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("settings.section.server")}</MenuV2.GroupLabel>
            <MenuV2.Item
              disabled={builtin || props.server.type !== "http"}
              onSelect={() => props.onEdit(props.server as ServerConnection.Http)}
            >
              {language.t("dialog.server.menu.edit")}
            </MenuV2.Item>
            <Show when={props.controller.canDefault() && !isDefault()}>
              <MenuV2.Item onSelect={() => props.controller.setDefault(key)}>
                {language.t("dialog.server.menu.default")}
              </MenuV2.Item>
            </Show>
            <Show when={props.controller.canDefault() && isDefault()}>
              <MenuV2.Item onSelect={() => props.controller.setDefault(null)}>
                {language.t("dialog.server.menu.defaultRemove")}
              </MenuV2.Item>
            </Show>
            <MenuV2.Separator />
            <MenuV2.Item disabled={builtin} onSelect={() => props.controller.handleRemove(key)}>
              {language.t("dialog.server.menu.delete")}
            </MenuV2.Item>
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
