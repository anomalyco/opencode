import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { QueryClientProvider } from "@tanstack/solid-query"
import { createMemo, For, type ParentProps, Show } from "solid-js"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { ModelsProvider } from "@/context/models"
import { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { useGlobal } from "@/context/global"
import { useSettings } from "@/context/settings"

export function SettingsServerScope(props: ParentProps) {
  const global = useGlobal()
  const settings = useSettings()

  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={props.children}>
      <Show when={global.settings.server.selected()}>
        {(server) => <SettingsServerDataProviders server={server()}>{props.children}</SettingsServerDataProviders>}
      </Show>
    </Show>
  )
}

function SettingsServerDataProviders(props: ParentProps<{ server: ServerConnection.Any }>) {
  const global = useGlobal()
  const serverCtx = () => global.createServerCtx(props.server)

  return (
    <QueryClientProvider client={serverCtx().queryClient}>
      <ServerSDKProvider server={() => props.server}>
        <ServerSyncProvider>
          <ModelsProvider>{props.children}</ModelsProvider>
        </ServerSyncProvider>
      </ServerSDKProvider>
    </QueryClientProvider>
  )
}

export function SettingsServerPicker() {
  const global = useGlobal()
  const settings = useSettings()
  const selected = createMemo(() =>
    settings.general.newLayoutDesigns() ? global.settings.server.selected() : undefined,
  )

  return (
    <Show when={selected()}>
      {(conn) => (
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={Button}
            variant="secondary"
            size="large"
            class="h-8 max-w-[260px] gap-2 px-2 py-1.5 data-[expanded]:bg-surface-base-active"
          >
            <ServerHealthIndicator health={global.servers.health[ServerConnection.key(conn())]} />
            <ServerRow
              conn={conn()}
              status={global.servers.health[ServerConnection.key(conn())]}
              class="flex items-center gap-2 min-w-0 flex-1"
              nameClass="text-14-regular text-text-base truncate"
              versionClass="hidden"
            />
            <Icon name="chevron-down" size="small" class="text-icon-weak shrink-0" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="w-[320px] mt-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-2 [&_[data-slot=dropdown-menu-radio-item]]:pr-2">
              <DropdownMenu.RadioGroup
                value={global.settings.server.key}
                onChange={(key) => {
                  if (typeof key === "string") global.settings.server.set(ServerConnection.Key.make(key))
                }}
              >
                <For each={global.servers.list()}>
                  {(item) => {
                    const key = ServerConnection.key(item)
                    const blocked = () => global.servers.health[key]?.healthy === false
                    return (
                      <DropdownMenu.RadioItem value={key} disabled={blocked()}>
                        <ServerHealthIndicator health={global.servers.health[key]} />
                        <ServerRow
                          conn={item}
                          dimmed={blocked()}
                          status={global.servers.health[key]}
                          class="flex items-center gap-2 min-w-0 flex-1"
                          nameClass="text-14-regular text-text-base truncate"
                          versionClass="text-12-regular text-text-weak truncate"
                        />
                        <DropdownMenu.ItemIndicator>
                          <Icon name="check-small" size="small" class="text-icon-weak" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    )
                  }}
                </For>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      )}
    </Show>
  )
}
