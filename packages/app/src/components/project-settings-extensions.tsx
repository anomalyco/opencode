import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useMcpToggle } from "@/context/mcp"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { ExternalLink } from "./external-link"

type SkillItem = {
  name: string
  location: string
}

const pluginName = (item: string | [string, Record<string, unknown>]) => (typeof item === "string" ? item : item[0])
const skillKey = (item: SkillItem) => `${item.name}\n${item.location}`

const ExtensionCard: Component<{ children: unknown }> = (props) => (
  <div class="project-settings-extension-card">{props.children as any}</div>
)

const ExtensionRow: Component<{
  icon: "mcp" | "cube" | "post-skill" | "code"
  name: string
  status?: string
  children?: unknown
}> = (props) => (
  <div class="project-settings-extension-row">
    <div class="project-settings-extension-row-main">
      <Icon name={props.icon} class="project-settings-extension-row-icon" />
      <span class="project-settings-extension-row-name">{props.name}</span>
    </div>
    <Show when={props.status}>
      {(status) => (
        <span class="project-settings-extension-row-status">
          <span class="project-settings-extension-row-status-dot" />
          {status()}
        </span>
      )}
    </Show>
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
  const directorySDK = useSDK()
  const serverSync = useServerSync()
  const sync = useSync()
  const toggleMcp = useMcpToggle()

  const [serverMcp] = createResource(
    serverSDK,
    (sdk) =>
      sdk.api.mcp
        .list()
        .then((result) => Object.fromEntries(result.data.map((server) => [server.name, server.status])))
        .catch(() => ({})),
    { initialValue: {} },
  )
  const globalMcpNames = createMemo(() =>
    [...new Set([...Object.keys(serverSync.data.config.mcp ?? {}), ...Object.keys(serverMcp.latest)])].sort(),
  )
  const projectMcpNames = createMemo(() => {
    const shared = new Set(globalMcpNames())
    const configured = Object.keys(sync().data.config.mcp ?? {}).filter((name) => !shared.has(name))
    if (configured.length > 0) return configured.sort()
    return Object.keys(sync().data.mcp ?? {})
      .filter((name) => !shared.has(name))
      .sort()
  })
  const mcpEnabled = (name: string) => sync().data.mcp?.[name]?.status === "connected"

  const globalPlugins = createMemo(() => (serverSync.data.config.plugin ?? []).map(pluginName))
  const projectPlugins = createMemo(() => {
    const shared = new Set(globalPlugins())
    return (sync().data.config.plugin ?? []).map(pluginName).filter((name) => !shared.has(name))
  })

  const [serverSkills] = createResource(
    serverSDK,
    (sdk): Promise<SkillItem[]> =>
      sdk.api.skill.list().then((result) => result.data.map((item) => ({ name: item.name, location: item.location }))),
    { initialValue: [] },
  )
  const [directorySkills] = createResource(
    directorySDK,
    (sdk): Promise<SkillItem[]> =>
      sdk.api.skill
        .list({ location: { directory: sdk.directory } })
        .then((result) => result.data.map((item) => ({ name: item.name, location: item.location }))),
    { initialValue: [] },
  )
  const projectSkills = createMemo(() => {
    const shared = new Set(serverSkills.latest.map(skillKey))
    return directorySkills.latest.filter((item) => !shared.has(skillKey(item)))
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
          <TabsV2.Trigger value="lsps">{language.t("project.settings.extensions.tab.lsps")}</TabsV2.Trigger>
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
            <SharedSection count={serverSkills.latest.length}>{skillRows(serverSkills.latest)}</SharedSection>
          </div>
        </TabsV2.Content>

        <TabsV2.Content value="lsps">
          <div class="project-settings-extension-section">
            <div class="project-settings-extension-section-header">
              <span>{language.t("project.settings.extensions.lsp.detected")}</span>
              <span>{language.t("project.settings.extensions.lsp.description")}</span>
            </div>
            <Show when={sync().data.lsp.length > 0}>
              <ExtensionCard>
                <For each={sync().data.lsp}>
                  {(item) => (
                    <ExtensionRow
                      icon="code"
                      name={item.name || item.id}
                      status={
                        item.status === "error" ? language.t("project.settings.extensions.setupRequired") : undefined
                      }
                    />
                  )}
                </For>
              </ExtensionCard>
            </Show>
          </div>
        </TabsV2.Content>
      </TabsV2>
    </div>
  )
}
