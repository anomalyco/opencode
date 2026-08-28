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
  return (
    <ServerRowMenuView
      server={props.server}
      labels={serverMenuLabels(language)}
      canDefault={props.controller.canDefault()}
      isDefault={props.controller.defaultKey() === key}
      onEdit={props.onEdit}
      onSetDefault={() => props.controller.setDefault(key)}
      onRemoveDefault={() => props.controller.setDefault(null)}
      onRemove={() => props.controller.handleRemove(key)}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  )
}

export function serverMenuLabels(language: ReturnType<typeof useLanguage>) {
  return {
    more: language.t("common.moreOptions"),
    server: language.t("settings.section.server"),
    edit: language.t("dialog.server.menu.edit"),
    default: language.t("dialog.server.menu.default"),
    defaultRemove: language.t("dialog.server.menu.defaultRemove"),
    delete: language.t("dialog.server.menu.delete"),
  }
}

export const ServerRowMenuView: Component<{
  server: ServerConnection.Any
  labels: ReturnType<typeof serverMenuLabels>
  canDefault: boolean
  isDefault: boolean
  onEdit: (server: ServerConnection.Http) => void
  onSetDefault: () => void
  onRemoveDefault: () => void
  onRemove: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = (props) => {
  const builtin = () => ServerConnection.builtin(props.server)
  const httpServer = () => (props.server.type === "http" ? props.server : undefined)
  return (
    <MenuV2 gutter={6} modal={false} placement="bottom-end" open={props.open} onOpenChange={props.onOpenChange}>
      <MenuV2.Trigger
        as={IconButtonV2}
        variant="ghost-muted"
        size="small"
        icon={<IconV2 name="outline-dots" />}
        aria-label={props.labels.more}
      />
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{props.labels.server}</MenuV2.GroupLabel>
            <MenuV2.Item
              disabled={builtin() || !httpServer()}
              onSelect={() => {
                const server = httpServer()
                if (server) props.onEdit(server)
              }}
            >
              {props.labels.edit}
            </MenuV2.Item>
            <Show when={props.canDefault && !props.isDefault}>
              <MenuV2.Item onSelect={props.onSetDefault}>{props.labels.default}</MenuV2.Item>
            </Show>
            <Show when={props.canDefault && props.isDefault}>
              <MenuV2.Item onSelect={props.onRemoveDefault}>{props.labels.defaultRemove}</MenuV2.Item>
            </Show>
            <MenuV2.Separator />
            <MenuV2.Item disabled={builtin()} onSelect={props.onRemove}>
              {props.labels.delete}
            </MenuV2.Item>
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
