import { Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsPermissions } from "./settings-permissions"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsAgents } from "./settings-agents"
import { SettingsCommands } from "./settings-commands"
import { SettingsMcp } from "./settings-mcp"

export const DialogSettings: Component = () => {
  const language = useLanguage()

  return (
    <Dialog size="x-large">
      <Tabs orientation="vertical" variant="settings" defaultValue="general" class="h-full settings-dialog">
        <Tabs.List>
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "12px",
              width: "100%",
              "padding-top": "12px",
              "padding-bottom": "12px",
            }}
          >
            <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px", width: "100%" }}>
              <Tabs.Trigger value="general">
                <Icon name="sliders" />
                {language.t("settings.tab.general")}
              </Tabs.Trigger>
              <Tabs.Trigger value="shortcuts">
                <Icon name="keyboard" />
                {language.t("settings.tab.shortcuts")}
              </Tabs.Trigger>
            </div>
          </div>
          {/* <Tabs.SectionTitle>Server</Tabs.SectionTitle> */}
          {/* <Tabs.Trigger value="permissions"> */}
          {/*   <Icon name="checklist" /> */}
          {/*   Permissions */}
          {/* </Tabs.Trigger> */}
          {/* <Tabs.Trigger value="providers"> */}
          {/*   <Icon name="server" /> */}
          {/*   Providers */}
          {/* </Tabs.Trigger> */}
          {/* <Tabs.Trigger value="models"> */}
          {/*   <Icon name="brain" /> */}
          {/*   Models */}
          {/* </Tabs.Trigger> */}
          {/* <Tabs.Trigger value="agents"> */}
          {/*   <Icon name="task" /> */}
          {/*   Agents */}
          {/* </Tabs.Trigger> */}
          {/* <Tabs.Trigger value="commands"> */}
          {/*   <Icon name="console" /> */}
          {/*   Commands */}
          {/* </Tabs.Trigger> */}
          {/* <Tabs.Trigger value="mcp"> */}
          {/*   <Icon name="mcp" /> */}
          {/*   MCP */}
          {/* </Tabs.Trigger> */}
        </Tabs.List>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        {/* <Tabs.Content value="permissions" class="no-scrollbar"> */}
        {/*   <SettingsPermissions /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="providers" class="no-scrollbar"> */}
        {/*   <SettingsProviders /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="models" class="no-scrollbar"> */}
        {/*   <SettingsModels /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="agents" class="no-scrollbar"> */}
        {/*   <SettingsAgents /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="commands" class="no-scrollbar"> */}
        {/*   <SettingsCommands /> */}
        {/* </Tabs.Content> */}
        {/* <Tabs.Content value="mcp" class="no-scrollbar"> */}
        {/*   <SettingsMcp /> */}
        {/* </Tabs.Content> */}
      </Tabs>
    </Dialog>
  )
}
