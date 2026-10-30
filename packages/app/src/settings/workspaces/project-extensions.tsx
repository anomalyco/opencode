import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { useQuery } from "@tanstack/solid-query"
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useMcpToggle } from "@/providers/connect/mcp"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { pluginLabels } from "@/providers/catalog/plugin"
import { ProjectFolderMissing } from "./project-folder-missing"
import { configuredLanguageServers } from "./project-lsp"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import type { CIR } from "@opencode/schema/extension"
import "./project.css"

type SkillItem = {
  name: string
  path: string
}

const skillKey = (item: SkillItem) => `${item.name}\n${item.path}`

const ExtensionCard: Component<{ children: JSX.Element }> = (props) => (
  <SettingsList variant="catalog">{props.children}</SettingsList>
)

const ExtensionRow: Component<{
  icon: "mcp" | "cube" | "post-skill" | "code"
  name: string
  badge?: string
  description?: JSX.Element
  children?: JSX.Element
}> = (props) => (
  <div class="settings-extension-row project-settings-extension-row flex items-center justify-between p-3 border-b border-v2-border-border last:border-b-0">
    <div class="settings-extension-lead flex items-center gap-3 min-w-0">
      <Icon name={props.icon} class="project-settings-extension-row-icon shrink-0 text-v2-text-text-muted" />
      <div class="project-settings-extension-row-copy flex flex-col min-w-0">
        <div class="flex items-center gap-2">
          <span class="project-settings-extension-row-name settings-extension-name text-13-semibold text-v2-text-text-primary truncate">
            {props.name}
          </span>
          <Show when={props.badge}>
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
              {props.badge}
            </span>
          </Show>
        </div>
        <Show when={props.description}>
          <span class="project-settings-extension-row-description text-11-regular text-v2-text-text-muted truncate">
            {props.description}
          </span>
        </Show>
      </div>
    </div>
    {props.children}
  </div>
)

const ProjectSectionHeader: Component<{
  kind: string
  empty: boolean
  action: JSX.Element
}> = (props) => (
  <div class="project-settings-extension-section-header flex items-center justify-between py-2">
    <div class="project-settings-extension-section-copy">
      <span class="text-12-semibold text-v2-text-text-primary">
        {props.empty
          ? `No ${props.kind} installed yet`
          : `Installed ${props.kind}`}
      </span>
    </div>
    {props.action}
  </div>
)

const SharedSection: Component<{
  count: number
  children: JSX.Element
}> = (props) => {
  const [open, setOpen] = createSignal(false)

  return (
    <Show when={props.count > 0}>
      <div class="project-settings-shared mt-3">
        <button
          type="button"
          class="settings-models-group-trigger project-settings-shared-trigger text-11-medium text-v2-text-text-muted hover:text-v2-text-text-primary flex items-center gap-1.5 py-1"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-down" size="small" class={`transition-transform ${open() ? "rotate-180" : ""}`} />
          <span>Global Extensions ({props.count})</span>
        </button>
        <Show when={open()}>
          <ExtensionCard>{props.children}</ExtensionCard>
        </Show>
      </div>
    </Show>
  )
}

const ProjectLanguageServers: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const location = useWorkspaceLocation()

  const config = useQuery(() => ({
    queryKey: [server.scope, "settings-project-language-servers", location().directory],
    enabled: server.connection.status() === "connected",
    queryFn: () => server.api.config.get({ location: { directory: location().directory } }),
  }))

  const configured = createMemo(() =>
    configuredLanguageServers(config.isPending || config.isError ? [] : (config.data ?? [])),
  )

  const empty = () => !config.isPending && !config.isError && configured().servers.length === 0
  onCleanup(
    server.event.on("config.updated", (event) => {
      if (event.location && event.location.directory !== location().directory) return
      void config.refetch()
    }),
  )

  return (
    <div class="project-settings-extension-section">
      <div class="project-settings-extension-section-header">
        <div class="project-settings-extension-section-copy">
          <span>
            {language.t(
              empty()
                ? configured().disabled
                  ? "project.settings.extensions.lsp.disabled.title"
                  : "project.settings.extensions.lsp.empty.title"
                : "project.settings.extensions.lsp.configured",
            )}
          </span>
          <Show when={empty()}>
            <span class="project-settings-extension-empty-description">
              {language.t(
                configured().disabled
                  ? "project.settings.extensions.lsp.disabled.description"
                  : "project.settings.extensions.lsp.empty.description",
              )}
            </span>
          </Show>
        </div>
        <span>{language.t("project.settings.extensions.lsp.description")}</span>
      </div>
      <Show
        when={!config.isPending}
        fallback={<p class="project-settings-extension-empty-description">{language.t("common.loading")}</p>}
      >
        <Show
          when={!config.isError}
          fallback={
            <div class="project-settings-extension-section-copy" role="status">
              <span class="project-settings-extension-empty-description">
                {language.t("project.settings.extensions.lsp.loadFailed")}
              </span>
              <Button variant="ghost-muted" onClick={() => void config.refetch()}>
                {language.t("project.settings.extensions.lsp.retry")}
              </Button>
            </div>
          }
        >
          <Show when={configured().servers.length > 0}>
            <ExtensionCard>
              <For each={configured().servers}>
                {(item) => (
                  <ExtensionRow
                    icon="code"
                    name={item.name}
                    description={item.extensions.length ? <bdi dir="ltr">{item.extensions.join(", ")}</bdi> : undefined}
                  >
                    <span class="project-settings-extension-row-status text-11-regular text-v2-text-text-muted">
                      {language.t(
                        item.disabled
                          ? "project.settings.extensions.lsp.status.disabled"
                          : "project.settings.extensions.lsp.status.enabled",
                      )}
                    </span>
                  </ExtensionRow>
                )}
              </For>
            </ExtensionCard>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

export const ProjectSettingsExtensions: Component<{
  subtab?: NonNullable<SettingsView["subtab"]>
  onSubtab: (value: NonNullable<SettingsView["subtab"]>) => void
}> = (props) => {
  const language = useLanguage()
  const directorySDK = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()
  const toggleMcp = useMcpToggle(() => directorySDK().directory)

  // Universal Extension State
  const [showImportSkill, setShowImportSkill] = createSignal(false)
  const [skillSourceUrl, setSkillSourceUrl] = createSignal("")
  const [skillOverrideName, setSkillOverrideName] = createSignal("")
  const [skillImporting, setSkillImporting] = createSignal(false)
  const [skillImportResult, setSkillImportResult] = createSignal<CIR | undefined>()
  const [importError, setImportError] = createSignal<string | undefined>()

  // MCP Diagnostics State
  const [testingServer, setTestingServer] = createSignal<string | undefined>()
  const [mcpDiagnosticOutput, setMcpDiagnosticOutput] = createSignal<any | undefined>()

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const ref = { directory: directorySDK().directory }

    void Promise.all([
      data.location.mcp.server.sync(ref),
      data.location.skill.sync(ref),
    ]).catch(() => undefined)
  })

  // Universal extensions from registry
  const [universalExtensions, { refetch: refetchUniversal }] = createResource(
    () => serverSDK.connection.status() === "connected",
    async () => {
      try {
        const res = await (serverSDK.api as any).extension.list()
        return (res ?? []) as CIR[]
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )

  const handleImportSkill = async () => {
    const src = skillSourceUrl().trim()
    if (!src) return

    setSkillImporting(true)
    setImportError(undefined)
    setSkillImportResult(undefined)

    try {
      const cir = await (serverSDK.api as any).extension.install({
        payload: {
          sourceUrlOrPath: src,
          targetScope: "project",
          expectedCategory: "skill",
          overrideName: skillOverrideName().trim() || undefined,
        },
      })
      setSkillImportResult(cir)
      refetchUniversal()
      data.location.skill.sync({ directory: directorySDK().directory })
    } catch (err: any) {
      setImportError(err.message ?? "Failed to import skill.")
    } finally {
      setSkillImporting(false)
    }
  }

  const handleTestMcp = async (serverName: string) => {
    setTestingServer(serverName)
    setMcpDiagnosticOutput(undefined)

    try {
      const res = await (serverSDK.api as any).extension.mcp.test({
        payload: {
          name: serverName,
          config: {
            type: "local",
            command: [serverName],
          },
        },
      })
      setMcpDiagnosticOutput(res)
    } catch (err: any) {
      setMcpDiagnosticOutput({
        server: serverName,
        success: false,
        error: err.message ?? "Diagnostic failed",
      })
    } finally {
      setTestingServer(undefined)
    }
  }

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
    () =>
      serverSDK.api.plugin
        .list()
        .then((result) => result.data)
        .catch(() => []),
    { initialValue: [] },
  )

  const [projectPluginList] = createResource(
    () => (serverSDK.connection.status() === "connected" ? directorySDK().directory : undefined),
    (directory) =>
      serverSDK.api.plugin
        .list({ location: { directory } })
        .then((result) => result.data)
        .catch(() => []),
    { initialValue: [] },
  )

  const globalPlugins = createMemo(() => pluginLabels(globalPluginList.latest ?? []))

  const projectPlugins = createMemo(() => {
    const shared = new Set(globalPlugins())

    return pluginLabels(projectPluginList.latest ?? []).filter((name) => !shared.has(name))
  })

  const serverSkills = createMemo(() => data.location.skill.list() ?? [])

  const projectSkills = createMemo(() => {
    const shared = new Set(serverSkills().map(skillKey))

    return (data.location.skill.list({ directory: directorySDK().directory }) ?? []).filter(
      (item) => !shared.has(skillKey(item)),
    )
  })

  const ruleExtensions = createMemo(() =>
    universalExtensions().filter((ext) => ext.category === "rule"),
  )

  const mcpRows = (items: string[]) => (
    <For each={items}>
      {(name) => (
        <ExtensionRow icon="mcp" name={name}>
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="small"
              onClick={() => handleTestMcp(name)}
              disabled={testingServer() === name}
            >
              {testingServer() === name ? "Testing..." : "Diagnostics"}
            </Button>
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
          </div>
        </ExtensionRow>
      )}
    </For>
  )

  const pluginRows = (items: string[]) => (
    <For each={items}>
      {(name) => (
        <ExtensionRow icon="cube" name={name} badge="native" />
      )}
    </For>
  )

  const skillRows = (items: SkillItem[]) => (
    <For each={items}>
      {(item) => (
        <ExtensionRow
          icon="post-skill"
          name={item.name}
          badge="skill"
          description={item.path}
        />
      )}
    </For>
  )

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Universal Extension Center</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              Unified extension compatibility engine supporting OpenCode, Claude Code, OpenAI Codex, Antigravity, and Cursor.
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <ProjectFolderMissing />

        {/* MCP Diagnostic Output Modal */}
        <Show when={mcpDiagnosticOutput()}>
          {(diag) => (
            <div class="mb-4 p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <h3 class="text-13-semibold text-v2-text-text-primary">MCP Diagnostic: {diag().server}</h3>
                  <span class={`px-1.5 py-0.5 rounded text-[10px] font-medium ${diag().success ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                    {diag().success ? "PASS" : "FAIL"}
                  </span>
                </div>
                <Button variant="ghost" size="small" onClick={() => setMcpDiagnosticOutput(undefined)}>
                  Close
                </Button>
              </div>
              <div class="text-11-regular text-v2-text-text-muted">
                <span>Latency: {diag().latencyMs ?? 0}ms | Transport: {diag().transport ?? "stdio"}</span>
              </div>
              <Show when={diag().error}>
                <div class="p-2 bg-red-500/10 text-red-400 rounded text-11-regular font-mono">
                  {diag().error}
                </div>
              </Show>
              <Show when={diag().tools && diag().tools.length > 0}>
                <div class="text-11-medium text-v2-text-text-secondary">
                  Discovered Tools ({diag().tools.length}): {diag().tools.map((t: any) => t.name).join(", ")}
                </div>
              </Show>
            </div>
          )}
        </Show>

        {/* Import Skill Modal */}
        <Show when={showImportSkill()}>
          <div class="mb-4 p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-3">
            <h3 class="text-13-semibold text-v2-text-text-primary">Import Universal Agent Skill</h3>
            <p class="text-11-regular text-v2-text-text-muted">
              Import from Git URL (e.g. GitHub repository), local folder, or archive. Supports OpenCode, Claude Code, OpenAI Codex, and Antigravity formats.
            </p>
            <div class="flex flex-col gap-2">
              <label class="text-11-medium text-v2-text-text-secondary">Source Git URL or Directory Path</label>
              <TextInput
                value={skillSourceUrl()}
                onInput={(e) => setSkillSourceUrl(e.currentTarget.value)}
                placeholder="https://github.com/org/skill-repo or /path/to/skill"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-11-medium text-v2-text-text-secondary">Custom Name (Optional)</label>
              <TextInput
                value={skillOverrideName()}
                onInput={(e) => setSkillOverrideName(e.currentTarget.value)}
                placeholder="Custom skill name"
              />
            </div>

            <Show when={importError()}>
              <div class="p-2 bg-red-500/10 text-red-400 rounded text-11-regular">
                {importError()}
              </div>
            </Show>

            <Show when={skillImportResult()}>
              {(res) => (
                <div class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded text-11-regular flex flex-col gap-1">
                  <span class="text-emerald-400 font-semibold">Skill Imported Successfully!</span>
                  <span>Name: {res().name}</span>
                  <span>Origin Platform: {res().originPlatform}</span>
                  <span>Security Status: {res().security?.safe ? "Clean (Passed AST scan)" : "Warning"}</span>
                </div>
              )}
            </Show>

            <div class="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="small" onClick={() => setShowImportSkill(false)}>
                Close
              </Button>
              <Button
                variant="submit"
                size="small"
                onClick={handleImportSkill}
                disabled={skillImporting()}
              >
                {skillImporting() ? "Importing & Auditing..." : "Import Skill"}
              </Button>
            </div>
          </div>
        </Show>

        <Tabs
          variant="pill"
          value={props.subtab ?? "mcps"}
          onChange={(value) => {
            props.onSubtab(value as NonNullable<SettingsView["subtab"]>)
          }}
          class="project-settings-extension-tabs settings-subtabs"
        >
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("settings.extensions.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
            <Tabs.Trigger value="rules">Rules & Instructions</Tabs.Trigger>
            <Tabs.Trigger value="lsps">{language.t("project.settings.extensions.tab.lsps")}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcps">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="mcps"
                empty={projectMcpNames().length === 0}
                action={<span>{language.t("settings.extensions.manageConfig")}</span>}
              />
              <Show when={projectMcpNames().length > 0}>
                <ExtensionCard>{mcpRows(projectMcpNames())}</ExtensionCard>
              </Show>
              <SharedSection count={globalMcpNames().length}>{mcpRows(globalMcpNames())}</SharedSection>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="plugins"
                empty={projectPlugins().length === 0}
                action={<span>{language.t("settings.extensions.manageConfig")}</span>}
              />
              <Show when={projectPlugins().length > 0}>
                <ExtensionCard>{pluginRows(projectPlugins())}</ExtensionCard>
              </Show>
              <SharedSection count={globalPlugins().length}>{pluginRows(globalPlugins())}</SharedSection>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="skills"
                empty={projectSkills().length === 0}
                action={
                  <Button variant="submit" size="small" onClick={() => setShowImportSkill(true)}>
                    <Icon name="plus" size="small" class="mr-1" />
                    Import Universal Skill
                  </Button>
                }
              />
              <Show when={projectSkills().length > 0}>
                <ExtensionCard>{skillRows(projectSkills())}</ExtensionCard>
              </Show>
              <SharedSection count={serverSkills().length}>{skillRows(serverSkills())}</SharedSection>
            </div>
          </Tabs.Content>

          <Tabs.Content value="rules">
            <div class="project-settings-extension-section flex flex-col gap-3">
              <div class="text-11-regular text-v2-text-text-muted">
                Universal Rules and Instructions parsed across AGENTS.md, CLAUDE.md, and Cursor rules.
              </div>
              <ExtensionCard>
                <For
                  each={ruleExtensions()}
                  fallback={
                    <div class="p-3 text-center text-12-regular text-v2-text-text-muted">
                      No custom rules imported yet. Add AGENTS.md, CLAUDE.md, or .cursorrules in your workspace.
                    </div>
                  }
                >
                  {(rule) => (
                    <ExtensionRow
                      icon="code"
                      name={rule.name}
                      badge={rule.originPlatform}
                      description={`Scope: ${rule.scope} | Status: ${rule.status}`}
                    />
                  )}
                </For>
              </ExtensionCard>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lsps">
            <ProjectLanguageServers />
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
