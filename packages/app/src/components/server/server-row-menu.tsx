import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Menu } from "@opencode-ai/ui/menu"
import { type Component, Show } from "solid-js"
import type { ServerActionsController } from "@/components/server/server-management-controller"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/servers"

export const ServerRowMenu: Component<{
  server: ServerConnection.Any
  domain: ServerActionsController
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
      canDefault={props.domain.defaults.available()}
      isDefault={props.domain.defaults.key() === key}
      canRemove={props.domain.connection.canRemove(key)}
      onEdit={props.onEdit}
      onSetDefault={() => props.domain.defaults.set(key)}
      onRemoveDefault={() => props.domain.defaults.set(null)}
      onRemove={() => props.domain.connection.remove(key)}
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
  canRemove: boolean
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
    <Menu gutter={6} modal={false} placement="bottom-end" open={props.open} onOpenChange={props.onOpenChange}>
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size="small"
        icon={<Icon name="outline-dots" />}
        aria-label={props.labels.more}
      />
      <Menu.Portal>
        <Menu.Content>
          <Menu.Group>
            <Menu.GroupLabel>{props.labels.server}</Menu.GroupLabel>
            <Menu.Item
              disabled={builtin() || !httpServer()}
              onSelect={() => {
                const server = httpServer()
                if (server) props.onEdit(server)
              }}
            >
              {props.labels.edit}
            </Menu.Item>
            <Show when={props.canDefault && !props.isDefault}>
              <Menu.Item onSelect={props.onSetDefault}>{props.labels.default}</Menu.Item>
            </Show>
            <Show when={props.canDefault && props.isDefault}>
              <Menu.Item onSelect={props.onRemoveDefault}>{props.labels.defaultRemove}</Menu.Item>
            </Show>
            <Show when={props.canRemove}>
              <Menu.Separator />
              <Menu.Item onSelect={props.onRemove}>{props.labels.delete}</Menu.Item>
            </Show>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
