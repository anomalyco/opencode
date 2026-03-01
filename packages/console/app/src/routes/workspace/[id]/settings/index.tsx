import { Tabs } from "@kobalte/core/tabs"
import { SettingsSection } from "./settings-section"
import { PluginSettingsSection } from "./plugin-settings-section"

export default function () {
  return (
    <div data-page="workspace-[id]">
      <div data-slot="sections">
        <Tabs defaultValue="general" data-component="tabs">
          <Tabs.List data-slot="tablist">
            <Tabs.Trigger value="general" data-slot="tab">General</Tabs.Trigger>
            <Tabs.Trigger value="plugins" data-slot="tab">Plugins</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="general">
            <SettingsSection />
          </Tabs.Content>
          <Tabs.Content value="plugins">
            <PluginSettingsSection />
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  )
}
