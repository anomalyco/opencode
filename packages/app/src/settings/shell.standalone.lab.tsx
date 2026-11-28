import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { DialogLabRuntime, LAB_LOCKED_SERVER, LAB_SERVER } from "@/lab/dialog-runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { SettingsScreen } from "@/settings/shell"
import { SettingsSurfaceProvider, type SettingsRootTab } from "@/settings/surface"
import { LayoutProvider } from "@/shell/state/layout"

function SettingsLab(props: { tab: SettingsRootTab; subtab?: string; locked?: boolean }) {
  const history = createMemoryHistory()

  const query = new URLSearchParams({ tab: props.tab })

  if (props.subtab) query.set("subtab", props.subtab)

  if (props.locked) query.set("server", ServerConnection.key(LAB_LOCKED_SERVER))
  history.set({ value: `/settings?${query}`, replace: true, scroll: false })

  return (
    <DialogLabRuntime servers={props.locked ? [LAB_SERVER, LAB_LOCKED_SERVER] : undefined}>
      <div class="h-full min-h-[640px] w-full overflow-hidden bg-v2-background-bg-base">
        <MemoryRouter
          history={history}
          root={(rootProps) => (
            <LayoutProvider open={() => undefined}>
              <SettingsSurfaceProvider>{rootProps.children}</SettingsSurfaceProvider>
            </LayoutProvider>
          )}
        >
          <Route path="*all" component={SettingsScreen} />
        </MemoryRouter>
      </div>
    </DialogLabRuntime>
  )
}

export default {
  title: "App/Dialogs/Settings",
  id: "app-dialog-settings",
  parameters: {
    layout: "fullscreen",
  },
}

export const Preferences = {
  render: () => <SettingsLab tab="general" />,
}

export const Providers = {
  render: () => <SettingsLab tab="providers" />,
}

export const Models = {
  render: () => <SettingsLab tab="models" />,
}

export const Plugins = {
  render: () => <SettingsLab tab="extensions" subtab="plugins" />,
}

export const UnavailableServer = { render: () => <SettingsLab tab="providers" locked /> }
