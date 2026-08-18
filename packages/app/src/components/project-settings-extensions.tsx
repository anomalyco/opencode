import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { type Component, For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useMcpToggle } from "@/context/mcp"
import { useWorkspaceLocation } from "@/context/location"
import { useServerSDK } from "@/context/server-sdk"
import { useData } from "@/context/server"
import { ExternalLink } from "./external-link"

type SkillItem = {
  name: string
  location: string
}

const skillKey = (item: SkillItem) => `${item.name}\n${item.location}`

const ExtensionCard: Component<{ children: unknown }> = (props) => (
  <div class="project-settings-extension-card">{props.children as any}</div>
)

const ExtensionRow: Component<{
  icon: "mcp" | "cube" | "post-skill"
  name: string
  children?: unknown
}> = (props) => (
  <div class="project-settings-extension-row">
    <div class="project-settings-extension-row-main">
      <Icon name={props.icon} class="project-settings-extension-row-icon" />
      <span class="project-settings-extension-row-name">{props.name}</span>
    </div>
    {props.children as any}
  </div>
)

const SharedSection: Component<{
  count: number
  children: unknown
}> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={props.count > 0}>
      <div class="project-settings-shared">
        <button
          type="button"
          class="project-settings-shared-trigger"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-right" classList={{ "project-settings-shared-chevron": true, open: open() }} />
          <span>{language.t("project.settings.extensions.shared")}</span>
          <span class="project-settings-shared-count">{props.count}</span>
        </button>
        <Show when={open()}>
          <ExtensionCard>{props.children}</ExtensionCard>
        </Show>
      </div>
    </Show>
  )
}

export const ProjectSettingsExtensions: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const directorySDK = useWorkspaceLocation()
  const data = useData()
  const toggleMcp = useMcpToggle(() => directorySDK().directory)

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const ref = { directory: directorySDK().directory }
    void Promise.all([
      data.location.mcp.server.sync(),
      data.location.skill.sync(),
      data.location.mcp.server.sync(ref),
      data.location.skill.sync(ref),
    ]).catch(() => undefined)
  })

  const globalMcpNames = createMemo(() =>
    [...new Set((data.location.mcp.server.list() ?? []).map((server) => server.name))].sort(),
  )
  const projectMcpNames = createMemo(() => {
    const shared = new Set(globalMcpNames())
    return (data.location.mcp.server.list({ directory: directorySDK().directory }) ?? [])
      .map((server) => server.name)
      .filter((name) => !shared.has(name))
      .sort()
  })
  const mcpEnabled = (name: string) =>
    data.location.mcp.server.list({ directory: directorySDK().directory })?.find((server) => server.name === name)
      ?.status.status === "connected"

  const [globalPluginList] = createResource(
    () => serverSDK.connection.status() === "connected",
    () => serverSDK.api.plugin.list().then((result) => result.data),
  )
  const [projectPluginList] = createResource(
    () => (serverSDK.connection.status() === "connected" ? directorySDK().directory : undefined),
    (directory) => serverSDK.api.plugin.list({ location: { directory } }).then((result) => result.data),
  )
  const globalPlugins = createMemo(() => (globalPluginList.latest ?? []).map((item) => item.id))
  const projectPlugins = createMemo(() => {
    const shared = new Set(globalPlugins())
    return (projectPluginList.latest ?? []).map((item) => item.id).filter((name) => !shared.has(name))
  })

  const serverSkills = createMemo(() => data.location.skill.list() ?? [])
  const projectSkills = createMemo(() => {
    const shared = new Set(serverSkills().map(skillKey))
    return (data.location.skill.list({ directory: directorySDK().directory }) ?? []).filter(
      (item) => !shared.has(skillKey(item)),
    )
  })

  const mcpRows = (items: string[]) => (
    <For each={items}>
      {(name) => (
        <ExtensionRow icon="mcp" name={name}>
          <Switch
            checked={mcpEnabled(name)}
            disabled={toggleMcp.isPending && toggleMcp.variables === name}
            hideLabel
            onChange={() => {
              if (toggleMcp.isPending) return
              toggleMcp.mutate(name)
            }}
          >
            {name}
          </Switch>
        </ExtensionRow>
      )}
    </For>
  )

  const pluginRows = (items: string[]) => <For each={items}>{(name) => <ExtensionRow icon="cube" name={name} />}</For>

  const skillRows = (items: SkillItem[]) => (
    <For each={items}>{(item) => <ExtensionRow icon="post-skill" name={item.name} />}</For>
  )

  return (
    <div class="project-settings-extensions">
      <div class="project-settings-page-header">
        <h2>{language.t("settings.tab.extensions")}</h2>
        <span>{language.t("project.settings.extensions.description")}</span>
      </div>

      <TabsV2 variant="pill" defaultValue="mcps" class="project-settings-extension-tabs">
        <TabsV2.List>
          <TabsV2.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</TabsV2.Trigger>
          <TabsV2.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</TabsV2.Trigger>
          <TabsV2.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</TabsV2.Trigger>
          {/* TODO: Restore LSP status when V2 exposes it. */}
        </TabsV2.List>

        <TabsV2.Content value="mcps">
          <div class="project-settings-extension-section">
            <div class="project-settings-extension-section-header">
              <span>{language.t("project.settings.extensions.added")}</span>
              <span>{language.t("settings.extensions.manageConfig")}</span>
            </div>
            <Show when={projectMcpNames().length > 0}>
              <ExtensionCard>{mcpRows(projectMcpNames())}</ExtensionCard>
            </Show>
            <SharedSection count={globalMcpNames().length}>{mcpRows(globalMcpNames())}</SharedSection>
          </div>
        </TabsV2.Content>

        <TabsV2.Content value="plugins">
          <div class="project-settings-extension-section">
            <div class="project-settings-extension-section-header">
              <span>{language.t("project.settings.extensions.added")}</span>
              <span>{language.t("settings.extensions.manageConfig")}</span>
            </div>
            <Show when={projectPlugins().length > 0}>
              <ExtensionCard>{pluginRows(projectPlugins())}</ExtensionCard>
            </Show>
            <SharedSection count={globalPlugins().length}>{pluginRows(globalPlugins())}</SharedSection>
          </div>
        </TabsV2.Content>

        <TabsV2.Content value="skills">
          <div class="project-settings-extension-section">
            <div class="project-settings-extension-section-header">
              <span>{language.t("project.settings.extensions.added")}</span>
              <ExternalLink class="project-settings-extension-link" href="https://opencode.ai/docs/skills/">
                {language.t("settings.extensions.addSkills")}
              </ExternalLink>
            </div>
            <Show when={projectSkills().length > 0}>
              <ExtensionCard>{skillRows(projectSkills())}</ExtensionCard>
            </Show>
            <SharedSection count={serverSkills().length}>{skillRows(serverSkills())}</SharedSection>
          </div>
        </TabsV2.Content>
      </TabsV2>
    </div>
  )
}
