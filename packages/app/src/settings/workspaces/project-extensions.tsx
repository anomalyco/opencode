import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
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
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { ProjectFolderMissing } from "./project-folder-missing"
import { configuredLanguageServers } from "./project-lsp"
import { SettingsList } from "@/settings/list"
import type { SettingsView } from "@/settings/surface"
import type { CIR, Platform, PackageInspectionResult, CompatibilityProposal } from "@opencode/schema/extension"
import "./project.css"

const ExtensionCard: Component<{ children: JSX.Element }> = (props) => (
  <SettingsList variant="catalog">{props.children}</SettingsList>
)

const ExtensionRow: Component<{
  icon: "mcp" | "cube" | "post-skill" | "code"
  name: string
  badge?: string
  platform?: Platform
  description?: JSX.Element
  statusColor?: "emerald" | "amber" | "red" | "gray"
  children?: JSX.Element
}> = (props) => (
  <div class="settings-extension-row project-settings-extension-row flex items-center justify-between p-3 border-b border-v2-border-border last:border-b-0">
    <div class="settings-extension-lead flex items-center gap-3 min-w-0">
      <div class="relative shrink-0 flex items-center justify-center">
        <Icon name={props.icon} class="project-settings-extension-row-icon text-v2-text-text-muted" />
        <Show when={props.statusColor}>
          <span
            class={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
              props.statusColor === "emerald"
                ? "bg-emerald-500"
                : props.statusColor === "amber"
                  ? "bg-amber-500"
                  : props.statusColor === "red"
                    ? "bg-red-500"
                    : "bg-gray-400"
            }`}
          />
        </Show>
      </div>
      <div class="project-settings-extension-row-copy flex flex-col min-w-0">
        <div class="flex items-center gap-2">
          <span class="project-settings-extension-row-name settings-extension-name text-13-semibold text-v2-text-text-primary truncate">
            {props.name}
          </span>
          <Show when={props.platform}>
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium uppercase tracking-wider">
              {props.platform}
            </span>
          </Show>
          <Show when={props.badge}>
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-v2-surface-elevation-2 text-v2-text-text-secondary font-mono">
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
              <Button variant="ghost" onClick={() => void config.refetch()}>
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

const matchGlob = (pattern: string, path: string): boolean => {
  if (!pattern || pattern === "*") return true
  try {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    const regexStr = "^" + escaped.replace(/\*\*/g, ".*").replace(/\*(?!\*)/g, "[^/]*") + "$"
    return new RegExp(regexStr).test(path)
  } catch {
    return false
  }
}

export const ProjectSettingsExtensions: Component<{
  subtab?: NonNullable<SettingsView["subtab"]>
  onSubtab: (value: NonNullable<SettingsView["subtab"]>) => void
}> = (props) => {
  const directorySDK = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const data = useData()

  // Top subtab: default "skills"
  const currentSubtab = () => props.subtab ?? "skills"

  // Search & Filter State
  const [searchQuery, setSearchQuery] = createSignal("")
  const [platformFilter, setPlatformFilter] = createSignal<string>("all")
  const [scopeFilter, setScopeFilter] = createSignal<string>("all")

  // Modal States
  const [inspectModalOpen, setInspectModalOpen] = createSignal(false)
  const [inspectInputUrl, setInspectInputUrl] = createSignal("")
  const [inspectSubpath, setInspectSubpath] = createSignal("")
  const [inspecting, setInspecting] = createSignal(false)
  const [inspectResult, setInspectResult] = createSignal<PackageInspectionResult | undefined>()
  const [inspectError, setInspectError] = createSignal<string | undefined>()

  // Detail / Compatibility Report Drawer
  const [selectedCir, setSelectedCir] = createSignal<CIR | undefined>()
  const [compatibilityProposal, setCompatibilityProposal] = createSignal<CompatibilityProposal | undefined>()
  const [generatingProposal, setGeneratingProposal] = createSignal(false)

  // MCP Connection Testing State
  const [testingServer, setTestingServer] = createSignal<string | undefined>()
  const [mcpDiagnosticOutput, setMcpDiagnosticOutput] = createSignal<any | undefined>()

  // Rules State
  const [createRuleOpen, setCreateRuleOpen] = createSignal(false)
  const [newRuleName, setNewRuleName] = createSignal("")
  const [newRulePattern, setNewRulePattern] = createSignal("")
  const [newRuleContent, setNewRuleContent] = createSignal("")
  const [testMatchFile, setTestMatchFile] = createSignal("")

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

  // Filtered CIR list
  const filteredExtensions = createMemo(() => {
    let list = universalExtensions()
    const q = searchQuery().trim().toLowerCase()
    if (q) {
      list = list.filter(
        (ext) =>
          ext.name.toLowerCase().includes(q) ||
          ext.description?.toLowerCase().includes(q) ||
          ext.originPlatform.toLowerCase().includes(q),
      )
    }
    if (platformFilter() !== "all") {
      list = list.filter((ext) => ext.originPlatform === platformFilter())
    }
    if (scopeFilter() !== "all") {
      list = list.filter((ext) => ext.scope === scopeFilter())
    }
    return list
  })

  const skillExtensions = createMemo(() => filteredExtensions().filter((ext) => ext.category === "skill"))
  const mcpExtensions = createMemo(() => filteredExtensions().filter((ext) => ext.category === "mcp"))
  const ruleExtensions = createMemo(() => filteredExtensions().filter((ext) => ext.category === "rule"))
  const pluginExtensions = createMemo(() => filteredExtensions().filter((ext) => ext.category === "plugin"))

  // Package groups
  const packageGroups = createMemo(() => {
    const groups = new Map<string, CIR[]>()
    for (const ext of universalExtensions()) {
      const pkgId = ext.packageId ?? ext.id
      const existing = groups.get(pkgId) ?? []
      existing.push(ext)
      groups.set(pkgId, existing)
    }
    return Array.from(groups.entries()).map(([pkgId, items]) => ({
      packageId: pkgId,
      primaryPlatform: items[0]?.originPlatform ?? "custom",
      source: items[0]?.source,
      components: items,
    }))
  })

  // Actions
  const handleInspect = async () => {
    const src = inspectInputUrl().trim()
    if (!src) return

    setInspecting(true)
    setInspectError(undefined)
    setInspectResult(undefined)

    try {
      const res = await (serverSDK.api as any).extension.inspect({
        payload: {
          sourceUrlOrPath: src,
          subpath: inspectSubpath().trim() || undefined,
        },
      })
      setInspectResult(res)
    } catch (err: any) {
      setInspectError(err.message ?? "Inspection failed.")
    } finally {
      setInspecting(false)
    }
  }

  const handleInstallInspected = async (comp: CIR) => {
    try {
      await (serverSDK.api as any).extension.install({
        payload: {
          sourceUrlOrPath: comp.source.location,
          subpath: comp.source.subpath,
          ref: comp.source.ref,
          targetScope: comp.scope,
          expectedCategory: comp.category,
          overrideName: comp.name,
        },
      })
      refetchUniversal()
      setInspectModalOpen(false)
    } catch (err: any) {
      setInspectError(err.message ?? "Installation failed.")
    }
  }

  const handleToggle = async (id: string, current: boolean) => {
    try {
      await (serverSDK.api as any).extension.toggle({
        params: { id },
        payload: { enabled: !current },
      })
      refetchUniversal()
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await (serverSDK.api as any).extension.remove({
        params: { id },
      })
      refetchUniversal()
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleRollback = async (id: string, targetVer: string) => {
    try {
      await (serverSDK.api as any).extension.rollback({
        params: { id },
        payload: { targetVersion: targetVer },
      })
      refetchUniversal()
      setSelectedCir(undefined)
    } catch (err: any) {
      console.error(err)
    }
  }

  const handleCreateRule = async () => {
    const name = newRuleName().trim()
    const pattern = newRulePattern().trim()
    const content = newRuleContent().trim()
    if (!name || !content) return

    const ruleCir: CIR = {
      id: `rule-${name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`,
      name,
      description: `Rule matching: ${pattern || "*"}`,
      originPlatform: "opencode",
      category: "rule",
      scope: "project",
      version: "1.0.0",
      enabled: true,
      status: "enabled",
      executionMode: "native",
      source: {
        type: "local",
        location: "workspace",
      },
      permissions: {},
      metadata: {
        pattern: pattern || "*",
        alwaysApply: !pattern,
        instructions: content,
      },
    }

    try {
      await (serverSDK.api as any).extension.install({
        payload: {
          extension: ruleCir,
        },
      })
      void refetchUniversal()
      setCreateRuleOpen(false)
      setNewRuleName("")
      setNewRulePattern("")
      setNewRuleContent("")
    } catch (err: any) {
      console.error(err)
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
        latencyMs: 0,
        tools: [],
        error: err.message ?? "Diagnostic failed",
      })
    } finally {
      setTestingServer(undefined)
    }
  }

  const handleGenerateAdapter = async (cir: CIR) => {
    setGeneratingProposal(true)
    setCompatibilityProposal(undefined)
    try {
      const proposal = await (serverSDK.api as any).extension.proposeAdapter({
        payload: { cir },
      })
      setCompatibilityProposal(proposal)
    } catch (err: any) {
      console.error(err)
    } finally {
      setGeneratingProposal(false)
    }
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Customization & Integration Center</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              Universal Agent Extension Compatibility Engine supporting OpenCode, Claude Code, OpenAI Codex, Antigravity, and Cursor.
            </span>
          </div>
          <Button variant="submit" size="small" onClick={() => setInspectModalOpen(true)}>
            Import Extension
          </Button>
        </div>

        {/* Subtabs Navigation */}
        <div class="flex items-center gap-1 mt-4 border-b border-v2-border-border pb-1">
          <For
            each={[
              { id: "skills", label: "Skills", count: skillExtensions().length },
              { id: "mcps", label: "MCP Servers", count: mcpExtensions().length },
              { id: "rules", label: "Rules", count: ruleExtensions().length },
              { id: "plugins", label: "Plugins", count: pluginExtensions().length },
              { id: "packages", label: "Packages", count: packageGroups().length },
              { id: "adapters", label: "Compatibility", count: universalExtensions().length },
              { id: "lsps", label: "Language Servers", count: 0 },
            ] as const}
          >
            {(tab) => (
              <button
                type="button"
                class={`px-3 py-1.5 rounded-md text-12-medium transition-colors flex items-center gap-1.5 ${
                  currentSubtab() === tab.id
                    ? "bg-v2-surface-elevation-2 text-v2-text-text-primary"
                    : "text-v2-text-text-muted hover:text-v2-text-text-secondary"
                }`}
                onClick={() => props.onSubtab(tab.id as any)}
              >
                <span>{tab.label}</span>
                <Show when={tab.count > 0}>
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-v2-surface-elevation-1 text-v2-text-text-muted">
                    {tab.count}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* Search & Filter Bar */}
        <div class="flex items-center gap-3 mt-3">
          <div class="flex-1">
            <TextInput
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder="Search extensions, tools, or origins..."
            />
          </div>
          <div class="flex items-center gap-1">
            <For each={["all", "opencode", "claude", "codex", "antigravity", "cursor"]}>
              {(plat) => (
                <button
                  type="button"
                  class={`px-2 py-1 rounded text-[11px] capitalize ${
                    platformFilter() === plat
                      ? "bg-primary/20 text-primary font-medium"
                      : "text-v2-text-text-muted hover:text-v2-text-text-secondary"
                  }`}
                  onClick={() => setPlatformFilter(plat)}
                >
                  {plat}
                </button>
              )}
            </For>
          </div>
          <div class="flex items-center gap-1 border-l border-v2-border-border pl-2">
            <For each={["all", "project", "global"]}>
              {(sc) => (
                <button
                  type="button"
                  class={`px-2 py-1 rounded text-[11px] capitalize ${
                    scopeFilter() === sc
                      ? "bg-v2-surface-elevation-2 text-v2-text-text-primary font-medium"
                      : "text-v2-text-text-muted hover:text-v2-text-text-secondary"
                  }`}
                  onClick={() => setScopeFilter(sc)}
                >
                  {sc}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <ProjectFolderMissing />

        {/* 1. SKILLS SECTION */}
        <Show when={currentSubtab() === "skills"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Installed Skills ({skillExtensions().length})
              </span>
            </div>
            <Show
              when={skillExtensions().length > 0}
              fallback={
                <div class="p-8 text-center text-v2-text-text-muted text-12-regular border border-dashed border-v2-border-border rounded-lg">
                  No skills installed yet. Click "Import Extension" above to add a skill from GitHub or local directory.
                </div>
              }
            >
              <ExtensionCard>
                <For each={skillExtensions()}>
                  {(cir) => (
                    <ExtensionRow
                      icon="post-skill"
                      name={cir.name}
                      platform={cir.originPlatform}
                      badge={`v${cir.version}`}
                      description={cir.description ?? cir.source.location}
                      statusColor={cir.enabled ? "emerald" : "gray"}
                    >
                      <div class="flex items-center gap-2">
                        <Button variant="ghost" size="small" onClick={() => setSelectedCir(cir)}>
                          Inspect
                        </Button>
                        <Switch
                          checked={cir.enabled}
                          hideLabel
                          onChange={() => handleToggle(cir.id, cir.enabled)}
                        >
                          {cir.name}
                        </Switch>
                        <Button variant="danger" size="small" onClick={() => handleRemove(cir.id)}>
                          Uninstall
                        </Button>
                      </div>
                    </ExtensionRow>
                  )}
                </For>
              </ExtensionCard>
            </Show>
          </div>
        </Show>

        {/* 2. MCP SERVERS SECTION */}
        <Show when={currentSubtab() === "mcps"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Model Context Protocol Servers ({mcpExtensions().length})
              </span>
            </div>
            <Show
              when={mcpExtensions().length > 0}
              fallback={
                <div class="p-8 text-center text-v2-text-text-muted text-12-regular border border-dashed border-v2-border-border rounded-lg">
                  No MCP servers registered. Import from Claude Desktop or Cursor, or add a STDIO server.
                </div>
              }
            >
              <ExtensionCard>
                <For each={mcpExtensions()}>
                  {(cir) => (
                    <ExtensionRow
                      icon="mcp"
                      name={cir.name}
                      platform={cir.originPlatform}
                      badge={cir.source.type}
                      description={cir.description ?? cir.source.location}
                      statusColor={cir.enabled ? "emerald" : "gray"}
                    >
                      <div class="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => handleTestMcp(cir.name)}
                          disabled={testingServer() === cir.name}
                        >
                          {testingServer() === cir.name ? "Testing..." : "Test Connection"}
                        </Button>
                        <Switch
                          checked={cir.enabled}
                          hideLabel
                          onChange={() => handleToggle(cir.id, cir.enabled)}
                        >
                          {cir.name}
                        </Switch>
                        <Button variant="danger" size="small" onClick={() => handleRemove(cir.id)}>
                          Remove
                        </Button>
                      </div>
                    </ExtensionRow>
                  )}
                </For>
              </ExtensionCard>
            </Show>

            {/* Live Diagnostic Output Card */}
            <Show when={mcpDiagnosticOutput()}>
              {(diag) => (
                <div class="mt-4 p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <h3 class="text-13-semibold text-v2-text-text-primary">MCP Server Diagnostics: {diag().server}</h3>
                      <span
                        class={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          diag().success ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {diag().success ? "ONLINE" : "OFFLINE"}
                      </span>
                    </div>
                    <Button variant="ghost" size="small" onClick={() => setMcpDiagnosticOutput(undefined)}>
                      Dismiss
                    </Button>
                  </div>
                  <div class="text-11-regular text-v2-text-text-muted flex items-center gap-4">
                    <span>Latency: {diag().latencyMs ?? 0}ms</span>
                    <span>Transport: {diag().transport ?? "stdio"}</span>
                    <span>Discovered Tools: {diag().tools?.length ?? 0}</span>
                  </div>
                  <Show when={diag().tools && diag().tools.length > 0}>
                    <div class="mt-2 flex flex-col gap-1">
                      <span class="text-11-medium text-v2-text-text-secondary">Discovered Tools:</span>
                      <div class="grid grid-cols-2 gap-2">
                        <For each={diag().tools}>
                          {(tool: any) => (
                            <div class="p-2 bg-v2-surface-elevation-2 rounded border border-v2-border-border text-11-regular flex flex-col gap-0.5">
                              <span class="font-mono text-primary font-semibold">{tool.name}</span>
                              <span class="text-v2-text-text-muted truncate">{tool.description ?? "No description"}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>

        {/* 3. RULES & INSTRUCTIONS SECTION */}
        <Show when={currentSubtab() === "rules"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Instruction Rulesets ({ruleExtensions().length})
              </span>
              <Button variant="submit" size="small" onClick={() => setCreateRuleOpen(true)}>
                New Rule
              </Button>
            </div>
            <Show
              when={ruleExtensions().length > 0}
              fallback={
                <div class="p-8 text-center text-v2-text-text-muted text-12-regular border border-dashed border-v2-border-border rounded-lg">
                  No custom instruction rules found. OpenCode automatically loads AGENTS.md and CLAUDE.md from the workspace.
                </div>
              }
            >
              <ExtensionCard>
                <For each={ruleExtensions()}>
                  {(cir) => (
                    <ExtensionRow
                      icon="code"
                      name={cir.name}
                      platform={cir.originPlatform}
                      badge={cir.scope}
                      description={cir.description ?? "Ruleset"}
                      statusColor={cir.enabled ? "emerald" : "gray"}
                    >
                      <div class="flex items-center gap-2">
                        <Button variant="ghost" size="small" onClick={() => setSelectedCir(cir)}>
                          View Rules
                        </Button>
                        <Switch
                          checked={cir.enabled}
                          hideLabel
                          onChange={() => handleToggle(cir.id, cir.enabled)}
                        >
                          {cir.name}
                        </Switch>
                        <Button variant="danger" size="small" onClick={() => handleRemove(cir.id)}>
                          Delete
                        </Button>
                      </div>
                    </ExtensionRow>
                  )}
                </For>
              </ExtensionCard>
            </Show>

            {/* Live Pattern Matcher & Precedence Tester */}
            <div class="p-3 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-2 mt-2">
              <span class="text-12-semibold text-v2-text-text-primary">Live Pattern Matcher & Precedence Tester</span>
              <span class="text-11-regular text-v2-text-text-muted">
                Test a file path to preview which active instruction rules apply to the prompt context.
              </span>
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <TextInput
                    value={testMatchFile()}
                    onInput={(e) => setTestMatchFile(e.currentTarget.value)}
                    placeholder="Enter file path to test (e.g. src/settings/route.ts)..."
                  />
                </div>
              </div>
              <Show when={testMatchFile().trim()}>
                <div class="flex flex-col gap-1 mt-1">
                  <span class="text-10-semibold text-v2-text-text-muted uppercase">Matching Rules:</span>
                  {(() => {
                    const matches = ruleExtensions().filter(
                      (r) => r.enabled && matchGlob(((r.metadata?.pattern as string | undefined) ?? "*"), testMatchFile().trim()),
                    )
                    return matches.length > 0 ? (
                      <div class="flex flex-wrap gap-1">
                        <For each={matches}>
                          {(r) => (
                            <span class="px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-400 font-mono">
                              ✓ {r.name} ({((r.metadata?.pattern as string | undefined) ?? "*")})
                            </span>
                          )}
                        </For>
                      </div>
                    ) : (
                      <span class="text-11-regular text-v2-text-text-muted italic">No active rules match this path.</span>
                    )
                  })()}
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* 4. PLUGINS SECTION */}
        <Show when={currentSubtab() === "plugins"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Installed Plugins & Shims ({pluginExtensions().length})
              </span>
            </div>
            <Show
              when={pluginExtensions().length > 0}
              fallback={
                <div class="p-8 text-center text-v2-text-text-muted text-12-regular border border-dashed border-v2-border-border rounded-lg">
                  No external plugins installed. OpenCode loads native plugins from opencode.json.
                </div>
              }
            >
              <ExtensionCard>
                <For each={pluginExtensions()}>
                  {(cir) => (
                    <ExtensionRow
                      icon="cube"
                      name={cir.name}
                      platform={cir.originPlatform}
                      badge={cir.executionMode ?? "native"}
                      description={cir.description ?? "Plugin package"}
                      statusColor={cir.enabled ? "emerald" : "gray"}
                    >
                      <div class="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={generatingProposal()}
                          onClick={() => handleGenerateAdapter(cir)}
                        >
                          {generatingProposal() ? "Analyzing..." : "Adapter Gap Analysis"}
                        </Button>
                        <Switch
                          checked={cir.enabled}
                          hideLabel
                          onChange={() => handleToggle(cir.id, cir.enabled)}
                        >
                          {cir.name}
                        </Switch>
                        <Button variant="danger" size="small" onClick={() => handleRemove(cir.id)}>
                          Remove
                        </Button>
                      </div>
                    </ExtensionRow>
                  )}
                </For>
              </ExtensionCard>
            </Show>
          </div>
        </Show>

        {/* 5. IMPORTED PACKAGES SECTION */}
        <Show when={currentSubtab() === "packages"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Multi-Component Packages ({packageGroups().length})
              </span>
            </div>
            <Show
              when={packageGroups().length > 0}
              fallback={
                <div class="p-8 text-center text-v2-text-text-muted text-12-regular border border-dashed border-v2-border-border rounded-lg">
                  No multi-component packages imported yet.
                </div>
              }
            >
              <For each={packageGroups()}>
                {(pkg) => (
                  <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-13 text-v2-text-text-primary">{pkg.packageId}</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium uppercase">
                          {pkg.primaryPlatform}
                        </span>
                      </div>
                      <span class="text-11-regular text-v2-text-text-muted">
                        {pkg.components.length} components
                      </span>
                    </div>
                    <div class="text-11-regular text-v2-text-text-muted font-mono truncate">
                      Source: {pkg.source?.location ?? "local"}
                    </div>
                    <div class="flex flex-wrap gap-2 mt-2">
                      <For each={pkg.components}>
                        {(comp) => (
                          <div class="px-2.5 py-1 bg-v2-surface-elevation-2 rounded border border-v2-border-border flex items-center gap-1.5 text-11-medium">
                            <span class="capitalize text-primary font-semibold">{comp.category}:</span>
                            <span class="text-v2-text-text-primary">{comp.name}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* 6. COMPATIBILITY & ADAPTERS SECTION */}
        <Show when={currentSubtab() === "adapters"}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between py-1">
              <span class="text-12-semibold text-v2-text-text-primary">
                Compatibility Engine & Active Adapters
              </span>
            </div>
            <div class="p-4 bg-v2-surface-elevation-1 border border-v2-border-border rounded-lg flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-13-semibold text-v2-text-text-primary">Ecosystem Adapters</span>
                <span class="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-bold">ACTIVE</span>
              </div>
              <p class="text-11-regular text-v2-text-text-muted">
                The Universal Agent Extension Compatibility Engine natively routes tools, hooks, and instructions from OpenAI Codex, Claude Code, Google Antigravity, and Cursor into OpenCode runtime primitives.
              </p>
              <div class="grid grid-cols-2 gap-3 mt-2">
                <div class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border flex flex-col gap-1">
                  <span class="text-12-semibold text-v2-text-text-primary">Skills Compatibility</span>
                  <span class="text-11-regular text-v2-text-text-muted">Preserves full directory structure, supporting scripts, and translates YAML frontmatter.</span>
                </div>
                <div class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border flex flex-col gap-1">
                  <span class="text-12-semibold text-v2-text-text-primary">MCP Preflight Diagnostics</span>
                  <span class="text-11-regular text-v2-text-text-muted">Live handshake testing, transport latency profiling, and dynamic tool discovery.</span>
                </div>
                <div class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border flex flex-col gap-1">
                  <span class="text-12-semibold text-v2-text-text-primary">Universal Rules Engine</span>
                  <span class="text-11-regular text-v2-text-text-muted">Evaluates AGENTS.md, CLAUDE.md, and Cursor MDC globs against active files.</span>
                </div>
                <div class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border flex flex-col gap-1">
                  <span class="text-12-semibold text-v2-text-text-primary">Security Sandbox</span>
                  <span class="text-11-regular text-v2-text-text-muted">Static AST threat scanner rejects path traversal, eval, and secret exposure before execution.</span>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* 7. LSP SECTION */}
        <Show when={currentSubtab() === "lsps"}>
          <ProjectLanguageServers />
        </Show>

        {/* PRE-INSTALLATION INSPECTION MODAL */}
        <Show when={inspectModalOpen()}>
          <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div class="bg-v2-surface-elevation-1 border border-v2-border-border rounded-xl max-w-xl w-full p-6 flex flex-col gap-4 shadow-2xl">
              <div class="flex items-center justify-between">
                <h3 class="text-14-semibold text-v2-text-text-primary">Inspect & Import Universal Extension</h3>
                <Button variant="ghost" size="small" onClick={() => setInspectModalOpen(false)}>
                  Close
                </Button>
              </div>

              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-11-medium text-v2-text-text-secondary">Source Git URL or Local Path</label>
                  <TextInput
                    value={inspectInputUrl()}
                    onInput={(e) => setInspectInputUrl(e.currentTarget.value)}
                    placeholder="https://github.com/org/repo or /path/to/extension"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-11-medium text-v2-text-text-secondary">Subpath in Repository (Optional)</label>
                  <TextInput
                    value={inspectSubpath()}
                    onInput={(e) => setInspectSubpath(e.currentTarget.value)}
                    placeholder="e.g. skills/data-analysis"
                  />
                </div>

                <Button
                  variant="submit"
                  size="small"
                  onClick={handleInspect}
                  disabled={inspecting() || !inspectInputUrl().trim()}
                >
                  {inspecting() ? "Inspecting Package..." : "Inspect Package"}
                </Button>
              </div>

              <Show when={inspectError()}>
                <div class="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded text-11-regular">
                  {inspectError()}
                </div>
              </Show>

              <Show when={inspectResult()}>
                {(res) => (
                  <div class="mt-2 p-4 bg-v2-surface-elevation-2 rounded-lg border border-v2-border-border flex flex-col gap-3">
                    <div class="flex items-center justify-between">
                      <span class="text-12-semibold text-v2-text-text-primary">Discovered Components ({res().components.length})</span>
                      <span
                        class={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          res().security.safe ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        SECURITY: {res().security.riskLevel.toUpperCase()}
                      </span>
                    </div>

                    <div class="flex flex-col gap-2 max-h-48 overflow-y-auto">
                      <For each={res().components}>
                        {(comp) => (
                          <div class="p-2 bg-v2-surface-elevation-1 rounded border border-v2-border-border flex items-center justify-between">
                            <div class="flex flex-col min-w-0">
                              <span class="text-12-medium text-v2-text-text-primary truncate">{comp.name}</span>
                              <span class="text-10-regular text-v2-text-text-muted capitalize">
                                {comp.originPlatform} • {comp.category} • v{comp.version}
                              </span>
                            </div>
                            <Button variant="submit" size="small" onClick={() => handleInstallInspected(comp)}>
                              Install
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>

        {/* DETAILS & COMPATIBILITY REPORT DRAWER */}
        <Show when={selectedCir()}>
          {(cir) => (
            <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div class="bg-v2-surface-elevation-1 border border-v2-border-border rounded-xl max-w-xl w-full p-6 flex flex-col gap-4 shadow-2xl">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <h3 class="text-14-semibold text-v2-text-text-primary">{cir().name}</h3>
                    <span class="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium uppercase">
                      {cir().originPlatform}
                    </span>
                    <span class="px-1.5 py-0.5 rounded text-[10px] bg-v2-surface-elevation-2 font-mono">
                      v{cir().version}
                    </span>
                  </div>
                  <Button variant="ghost" size="small" onClick={() => setSelectedCir(undefined)}>
                    Close
                  </Button>
                </div>

                <div class="text-12-regular text-v2-text-text-secondary">
                  {cir().description ?? "No description provided."}
                </div>

                <div class="grid grid-cols-2 gap-3 text-11-regular">
                  <div class="p-2.5 bg-v2-surface-elevation-2 rounded border border-v2-border-border">
                    <span class="text-v2-text-text-muted">Category:</span> <span class="capitalize font-medium">{cir().category}</span>
                  </div>
                  <div class="p-2.5 bg-v2-surface-elevation-2 rounded border border-v2-border-border">
                    <span class="text-v2-text-text-muted">Scope:</span> <span class="capitalize font-medium">{cir().scope}</span>
                  </div>
                  <div class="p-2.5 bg-v2-surface-elevation-2 rounded border border-v2-border-border">
                    <span class="text-v2-text-text-muted">Mode:</span> <span class="capitalize font-medium">{cir().executionMode ?? "native"}</span>
                  </div>
                  <div class="p-2.5 bg-v2-surface-elevation-2 rounded border border-v2-border-border">
                    <span class="text-v2-text-text-muted">Status:</span> <span class="capitalize font-medium">{cir().status}</span>
                  </div>
                </div>

                {/* Security Audit Findings */}
                <div class="flex flex-col gap-1.5">
                  <span class="text-12-semibold text-v2-text-text-primary">Static AST Security Audit</span>
                  <div class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border text-11-regular flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                      <span>Scanned files: {cir().security?.scannedFiles ?? 1}</span>
                      <span class={`font-bold ${cir().security?.safe ? "text-emerald-400" : "text-amber-400"}`}>
                        Risk: {cir().security?.riskLevel ?? "low"}
                      </span>
                    </div>
                    <Show when={cir().security?.findings && cir().security!.findings.length > 0}>
                      <For each={cir().security!.findings}>
                        {(f) => (
                          <div class="mt-1 p-2 bg-red-500/10 text-red-400 rounded text-10-regular">
                            [{f.code}] {f.message} (line {f.line ?? 1})
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-v2-border-border">
                  <Button variant="danger" size="small" onClick={() => handleRemove(cir().id)}>
                    Uninstall
                  </Button>
                  <Button variant="submit" size="small" onClick={() => handleRollback(cir().id, "1.0.0")}>
                    Rollback to v1.0.0
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Show>

        {/* AI-ASSISTED ADAPTER GENERATOR MODAL */}
        <Show when={compatibilityProposal()}>
          {(prop) => (
            <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div class="bg-v2-surface-elevation-1 border border-v2-border-border rounded-xl max-w-2xl w-full p-6 flex flex-col gap-4 shadow-2xl">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <h3 class="text-14-semibold text-v2-text-text-primary">AI Compatibility Proposal</h3>
                    <span class="px-2 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-bold">
                      SCORE: {prop().compatibilityScore}%
                    </span>
                  </div>
                  <Button variant="ghost" size="small" onClick={() => setCompatibilityProposal(undefined)}>
                    Close
                  </Button>
                </div>

                <div class="flex flex-col gap-2">
                  <span class="text-12-medium text-v2-text-text-primary">Mappable Capabilities:</span>
                  <div class="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    <For each={prop().mappableCapabilities}>
                      {(m) => (
                        <div class="p-2 bg-v2-surface-elevation-2 rounded border border-v2-border-border text-11-regular flex items-center justify-between">
                          <span class="font-mono text-amber-400">{m.capability}</span>
                          <span class="text-v2-text-text-muted">➔ {m.targetApi} ({m.adapterStrategy})</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <Show when={prop().missingCapabilities.length > 0}>
                  <div class="flex flex-col gap-1">
                    <span class="text-12-medium text-red-400">Unsupported Capabilities (Cannot Fabricate):</span>
                    <For each={prop().missingCapabilities}>
                      {(miss) => (
                        <span class="text-11-regular text-red-400 font-mono">• {miss}</span>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={prop().generatedAdapterCode}>
                  <div class="flex flex-col gap-1">
                    <span class="text-12-medium text-v2-text-text-primary">Generated Compatibility Shim:</span>
                    <pre class="p-3 bg-v2-surface-elevation-2 rounded border border-v2-border-border text-[10px] font-mono overflow-x-auto max-h-36">
                      {prop().generatedAdapterCode}
                    </pre>
                  </div>
                </Show>

                <div class="flex items-center justify-end gap-2 pt-2 border-t border-v2-border-border">
                  <Button variant="ghost" size="small" onClick={() => setCompatibilityProposal(undefined)}>
                    Reject
                  </Button>
                  <Button
                    variant="submit"
                    size="small"
                    disabled={!prop().compatible}
                    onClick={() => {
                      alert("Adapter approved and saved!")
                      setCompatibilityProposal(undefined)
                    }}
                  >
                    Approve & Save Adapter
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Show>

        {/* CREATE RULE MODAL */}
        <Show when={createRuleOpen()}>
          <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div class="bg-v2-surface-elevation-1 border border-v2-border-border rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 shadow-2xl">
              <div class="flex items-center justify-between">
                <h3 class="text-14-semibold text-v2-text-text-primary">Create New Instruction Rule</h3>
                <Button variant="ghost" size="small" onClick={() => setCreateRuleOpen(false)}>
                  Cancel
                </Button>
              </div>

              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1">
                  <label class="text-11-medium text-v2-text-text-secondary">Rule Name</label>
                  <TextInput
                    value={newRuleName()}
                    onInput={(e) => setNewRuleName(e.currentTarget.value)}
                    placeholder="e.g. TypeScript Code Quality"
                  />
                </div>

                <div class="flex flex-col gap-1">
                  <label class="text-11-medium text-v2-text-text-secondary">File Pattern (Glob)</label>
                  <TextInput
                    value={newRulePattern()}
                    onInput={(e) => setNewRulePattern(e.currentTarget.value)}
                    placeholder="e.g. src/**/*.tsx (leave blank for always apply)"
                  />
                </div>

                <div class="flex flex-col gap-1">
                  <label class="text-11-medium text-v2-text-text-secondary">Instructions (Markdown)</label>
                  <textarea
                    class="w-full h-32 p-2.5 rounded-lg bg-v2-surface-elevation-2 border border-v2-border-border text-12-regular text-v2-text-text-primary focus:outline-none focus:border-primary font-mono resize-y"
                    value={newRuleContent()}
                    onInput={(e) => setNewRuleContent(e.currentTarget.value)}
                    placeholder="Specify instructions or constraints for the agent when editing matching files..."
                  />
                </div>
              </div>

              <div class="flex items-center justify-end gap-2 pt-2 border-t border-v2-border-border">
                <Button variant="ghost" size="small" onClick={() => setCreateRuleOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="submit"
                  size="small"
                  disabled={!newRuleName().trim() || !newRuleContent().trim()}
                  onClick={handleCreateRule}
                >
                  Save Rule
                </Button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </>
  )
}
