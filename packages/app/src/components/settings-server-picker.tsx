import { type ParentProps, Show } from "solid-js"
import { useGlobal } from "@/context/global"
import { ModelsProvider } from "@/context/models"
import { ServerProvider } from "@/context/server"
import { ServerConnection } from "@/context/servers"

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
    <ServerProvider conn={props.server}>
      <ModelsProvider directory={props.directory}>{props.children}</ModelsProvider>
    </ServerProvider>
  )
}
