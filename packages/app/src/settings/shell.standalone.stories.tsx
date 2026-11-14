import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { DialogStoryRuntime, STORY_LOCKED_SERVER, STORY_SERVER } from "@/components-lab/dialog-story-runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { SettingsScreen } from "@/settings/shell"
import { SettingsSurfaceProvider, type SettingsRootTab } from "@/settings/surface"
import { LayoutProvider } from "@/shell/state/layout"

function SettingsStory(props: { tab: SettingsRootTab; locked?: boolean }) {
  const history = createMemoryHistory()

  const query = new URLSearchParams({ tab: props.tab })

  if (props.locked) query.set("server", ServerConnection.key(STORY_LOCKED_SERVER))
  history.set({ value: `/settings?${query}`, replace: true, scroll: false })

  return (
    <DialogStoryRuntime servers={props.locked ? [STORY_SERVER, STORY_LOCKED_SERVER] : undefined}>
      <div class="h-full min-h-[640px] w-full overflow-hidden bg-v2-background-bg-base">
        <MemoryRouter
          history={history}
          root={(rootProps) => (
            <LayoutProvider>
              <SettingsSurfaceProvider>{rootProps.children}</SettingsSurfaceProvider>
            </LayoutProvider>
          )}
        >
          <Route path="*all" component={SettingsScreen} />
        </MemoryRouter>
      </div>
    </DialogStoryRuntime>
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
  render: () => <SettingsStory tab="general" />,
}

export const Providers = {
  render: () => <SettingsStory tab="providers" />,
}

export const Models = {
  render: () => <SettingsStory tab="models" />,
}

export const UnavailableServer = { render: () => <SettingsStory tab="providers" locked /> }
