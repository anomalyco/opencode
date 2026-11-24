import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { type Component, createMemo, For, Show } from "solid-js"
import type { ServerActionsController } from "@/servers/registry/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { createShellOptions } from "@/settings/general/behavior"
import type { ShellSettingsController } from "@/settings/general/controllers"

export const ServerRowMenu: Component<{
  server: ServerConnection.Any
  domain: ServerActionsController
  onEdit: (server: ServerConnection.Http) => void
  shell?: ShellSettingsController
  action?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const key = ServerConnection.key(props.server)

  return (
    <ServerRowMenuView
      server={props.server}
      labels={serverMenuLabels(language)}
      canRemove={props.domain.connection.canRemove(key)}
      canHide={props.domain.connection.canHide(key)}
      hidden={props.domain.connection.isHidden(key)}
      shell={props.shell}
      action={props.action}
      onEdit={props.onEdit}
      onRemove={() => props.domain.connection.remove(key)}
      onHide={() => props.domain.connection.setHidden(key, true)}
      onShow={() => props.domain.connection.setHidden(key, false)}
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
    remove: language.t("dialog.server.menu.remove"),
    hide: language.t("dialog.server.menu.hide"),
    show: language.t("dialog.server.menu.show"),
    shell: language.t("settings.general.row.shell.title"),
    shellAuto: language.t("settings.general.row.shell.autoDefault"),
    shellTerminalOnly: language.t("settings.general.row.shell.terminalOnly"),
  }
}

export const ServerRowMenuView: Component<{
  server: ServerConnection.Any
  labels: ReturnType<typeof serverMenuLabels>
  canRemove: boolean
  canHide?: boolean
  hidden?: boolean
  shell?: ShellSettingsController
  action?: string
  onEdit: (server: ServerConnection.Http) => void
  onRemove: () => void
  onHide?: () => void
  onShow?: () => void
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
        data-action={props.action}
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
            <Show when={props.shell}>{(shell) => <ShellSubmenu shell={shell()} labels={props.labels} />}</Show>
            <Show when={props.hidden}>
              <Menu.Item onSelect={props.onShow}>{props.labels.show}</Menu.Item>
            </Show>
            <Show when={!props.hidden && props.canHide}>
              <Menu.Item onSelect={props.onHide}>{props.labels.hide}</Menu.Item>
            </Show>
            <Show when={props.canRemove}>
              <Menu.Separator />
              <Menu.Item onSelect={props.onRemove}>{props.labels.remove}</Menu.Item>
            </Show>
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

function ShellSubmenu(props: { shell: ShellSettingsController; labels: ReturnType<typeof serverMenuLabels> }) {
  const options = createMemo(() =>
    createShellOptions({ shells: props.shell.shells(), current: props.shell.current() }),
  )

  const current = () => options().find((option) => option.value === props.shell.current())?.id ?? "auto"

  return (
    <Menu.Sub gutter={4} overflowPadding={16} overlap>
      <Menu.SubTrigger>{props.labels.shell}</Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent class="w-max min-w-[172px] max-w-[calc(100vw-32px)]" aria-label={props.labels.shell}>
          <Menu.RadioGroup
            value={current()}
            onChange={(id) => {
              const option = options().find((item) => item.id === id)

              if (option) props.shell.select(option.value)
            }}
          >
            <For each={options()}>
              {(option) => (
                <Menu.RadioItem value={option.id}>
                  {option.id === "auto"
                    ? props.labels.shellAuto
                    : option.terminalOnly
                      ? `${option.name} (${props.labels.shellTerminalOnly})`
                      : option.name}
                </Menu.RadioItem>
              )}
            </For>
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  )
}
