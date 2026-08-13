import { type ParentProps, Show } from "solid-js"
import { useGlobal } from "@/context/global"
import { ModelsProvider } from "@/context/models"
import { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"

export function SettingsServerScope(props: ParentProps<{ directory?: string }>) {
  const global = useGlobal()
  return (
    <Show when={global.settings.server.selected()} keyed fallback={props.children}>
      {(server) => (
        <SettingsServerDataScope server={server} directory={props.directory}>
          {props.children}
        </SettingsServerDataScope>
      )}
    </Show>
  )
}

export function SettingsServerDataScope(props: ParentProps<{ server: ServerConnection.Any; directory?: string }>) {
  return (
    <ServerSDKProvider server={props.server}>
      <ServerSyncProvider server={props.server}>
        <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
      </ServerSyncProvider>
    </ServerSDKProvider>
  )
}
