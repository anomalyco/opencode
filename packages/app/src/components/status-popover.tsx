import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { type Accessor, createEffect, createMemo, createSignal, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { claude, item, label, mcp, parse, skill } from "@/components/status-popover-data"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSkills } from "@/context/skills"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { isFilePath } from "@/utils/config-source"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"

const pollMs = 10_000

function configPath(root: string | undefined, file: string) {
  if (!root || !isFilePath(root)) return
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return `${root.replace(/[\\/]+$/, "")}${sep}${file.replace(/^[\\/]+/, "")}`
}

const pluginEmptyMessage = (value: string, file: string): JSXElement => {
  const parts = value.split(file)
  if (parts.length === 1) return value
  return (
    <>
      {parts[0]}
      <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{file}</code>
      {parts.slice(1).join(file)}
    </>
  )
}

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) return
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    const stale = list.some((conn) => status[ServerConnection.key(conn)] === undefined)
    if (stale) void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return status
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    url: undefined as string | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("url", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setState("url", next ? normalizeServerUrl(next) : undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("url", normalizeServerUrl(result))
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      const u = state.url
      if (!u) return
      return ServerConnection.key({ type: "http", http: { url: u } })
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

const useMcpToggleMutation = (sdk: ReturnType<typeof useSDK>) => {
  const sync = useSync()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = sync.data.mcp[name]
      await (status?.status === "connected" ? sdk.client.mcp.disconnect({ name }) : sdk.client.mcp.connect({ name }))
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))
}

export function StatusPopover() {
  const sync = useSync()
  const global = useGlobalSync()
  const sdk = useSDK()
  const skills = useSkills()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const [shown, setShown] = createSignal(false)
  const [tab, setTab] = createSignal<"servers" | "mcp" | "lsp" | "plugins" | "skills">("servers")
  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })
  const servers = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (list.every((item) => ServerConnection.key(item) !== ServerConnection.key(current))) return [current, ...list]
    return [current, ...list.filter((item) => ServerConnection.key(item) !== ServerConnection.key(current))]
  })
  const health = useServerHealth(servers, () => shown() && tab() === "servers")
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const toggleMcp = useMcpToggleMutation(sdk)
  const defaultServer = useDefaultServerKey(platform.getDefaultServer)
  const [cfg, setCfg] = createStore({
    project: undefined as string | undefined,
    projectDir: undefined as string | undefined,
    claude: undefined as string | undefined,
    omo: undefined as string | undefined,
  })
  const mcpNames = createMemo(() => Object.keys(sync.data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const group = createMemo(() => label(sync.data.path.directory, global.data.project) || getFilename(sync.data.path.directory))
  const projectCfg = createMemo(() => parse(cfg.project))
  const projectDirCfg = createMemo(() => parse(cfg.projectDir))
  const claudeCfg = createMemo(() => claude(cfg.claude, sync.data.path.directory))
  const omo = createMemo(() => !!parse(cfg.omo))
  createEffect(() => {
    const read = platform.readConfigFile
    const list = platform.listConfigFiles
    const dir = sync.data.path.directory
    if (!read || !list || platform.platform !== "desktop" || !dir) {
      setCfg({ project: undefined, projectDir: undefined, omo: undefined })
      return
    }

    let dead = false
    void list(dir)
      .then(async (files) => {
        const project = files.find((item) => item.id === "project-opencode-jsonc" && item.exists)
          ?? files.find((item) => item.id === "project-opencode-json" && item.exists)
        const projectDir = files.find((item) => item.id === "project-dir-opencode-jsonc" && item.exists)
          ?? files.find((item) => item.id === "project-dir-opencode-json" && item.exists)
        const claudePath = configPath(global.data.path.home, ".claude.json")
        const omoJsonPath = configPath(global.data.path.config, "oh-my-openagent.json")
        const omoJsoncPath = configPath(global.data.path.config, "oh-my-openagent.jsonc")

        const [nextProject, nextProjectDir, nextClaude, nextOmo] = await Promise.all([
          project?.path ? read(project.path).catch(() => null) : Promise.resolve(null),
          projectDir?.path ? read(projectDir.path).catch(() => null) : Promise.resolve(null),
          claudePath ? read(claudePath).catch(() => null) : Promise.resolve(null),
          omoJsonPath
            ? read(omoJsonPath).catch(() => (omoJsoncPath ? read(omoJsoncPath).catch(() => null) : null))
            : Promise.resolve(null),
        ])
        if (dead) return
        setCfg({
          project: nextProject ?? undefined,
          projectDir: nextProjectDir ?? undefined,
          claude: nextClaude ?? undefined,
          omo: nextOmo ?? undefined,
        })
      })
      .catch(() => {
        if (dead) return
        setCfg({ project: undefined, projectDir: undefined, claude: undefined, omo: undefined })
      })

    onCleanup(() => {
      dead = true
    })
  })

  const mcpItems = createMemo(() =>
    mcpNames().map((name) =>
      mcp(
        name,
        sync.data.mcp?.[name],
        sync.data.config.mcp,
        global.data.config.mcp,
        projectCfg(),
        projectDirCfg(),
        claudeCfg(),
        omo(),
        group(),
      ),
    ),
  )
  const mcpConnected = createMemo(() => mcpNames().filter((name) => mcpStatus(name) === "connected").length)
  const lspItems = createMemo(() => sync.data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  const plugins = createMemo(() =>
    (sync.data.config.plugin ?? []).map((entry) => item(Array.isArray(entry) ? entry[0] : entry, global.data.project)),
  )
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "opencode.json"))
  const skillItems = createMemo(() =>
    skills
      .list()
      .map((entry) => skill(entry, global.data.project))
      .toSorted((a, b) => {
        const ar = a.scope === "global" ? 1 : 0
        const br = b.scope === "global" ? 1 : 0
        const rank = ar - br
        if (rank !== 0) return rank
        const scope = a.scope.localeCompare(b.scope)
        if (scope !== 0) return scope
        return a.name.localeCompare(b.name)
      }),
  )
  const skillCount = createMemo(() => skillItems().length)
  const skillTab = createMemo(() => {
    const text = language.t("status.popover.tab.skills")
    if (text !== "status.popover.tab.skills") return text
    return "Skills"
  })
  const skillEmpty = createMemo(() => {
    const text = language.t("dialog.skill.empty")
    if (text !== "dialog.skill.empty") return text
    return "No skills loaded"
  })

  const overallHealthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const anyMcpIssue = mcpNames().some((name) => {
      const status = mcpStatus(name)
      return status !== "connected" && status !== "disabled"
    })
    return serverHealthy && !anyMcpIssue
  })

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: value,
        })
      },
      (err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      },
    )
  }

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class: "titlebar-icon w-8 h-6 p-0 box-border",
        "aria-label": language.t("status.popover.trigger"),
        style: { scale: 1 },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": overallHealthy(),
              "bg-icon-critical-base": !overallHealthy() && server.healthy() !== undefined,
              "bg-border-weak-base": server.healthy() === undefined,
            }}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[min(720px,calc(100vw-40px))] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <div class="flex items-center gap-1 w-[min(720px,calc(100vw-40px))] rounded-xl shadow-[var(--shadow-lg-border-base)]">
        <Tabs
          aria-label={language.t("status.popover.ariaLabel")}
          class="tabs bg-background-strong rounded-xl overflow-hidden"
          data-component="tabs"
          data-active={tab()}
          value={tab()}
          onChange={(value) => {
            if (value === "servers" || value === "mcp" || value === "lsp" || value === "plugins" || value === "skills") {
              setTab(value)
            }
          }}
          variant="alt"
        >
          <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {sortedServers().length > 0 ? `${sortedServers().length} ` : ""}
              {language.t("status.popover.tab.servers")}
            </Tabs.Trigger>
            <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
              {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}
              {language.t("status.popover.tab.mcp")}
            </Tabs.Trigger>
            <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
              {lspCount() > 0 ? `${lspCount()} ` : ""}
              {language.t("status.popover.tab.lsp")}
            </Tabs.Trigger>
            <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
              {pluginCount() > 0 ? `${pluginCount()} ` : ""}
              {language.t("status.popover.tab.plugins")}
            </Tabs.Trigger>
            <Tabs.Trigger value="skills" data-slot="tab" class="text-12-regular">
              {skillCount() > 0 ? `${skillCount()} ` : ""}
              {skillTab()}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="servers">
            <Show when={tab() === "servers"}>
              <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                  <For each={sortedServers()}>
                    {(s) => {
                      const key = ServerConnection.key(s)
                      const isBlocked = () => health[key]?.healthy === false
                      return (
                        <div
                          class="status-list-item flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                          classList={{
                            "cursor-not-allowed": isBlocked(),
                          }}
                          aria-disabled={isBlocked()}
                        >
                          <ServerHealthIndicator health={health[key]} />
                          <ServerRow
                            conn={s}
                            dimmed={isBlocked()}
                            status={health[key]}
                            class="flex items-center gap-2 w-full min-w-0"
                            nameClass="text-14-regular text-text-base truncate"
                            versionClass="text-12-regular text-text-weak truncate"
                            badge={
                              <Show when={key === defaultServer.key()}>
                                <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                                  {language.t("common.default")}
                                </span>
                              </Show>
                            }
                          >
                            <div class="flex-1" />
                            <Show when={server.current && key === ServerConnection.key(server.current)}>
                              <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                            </Show>
                          </ServerRow>
                        </div>
                      )
                    }}
                  </For>

                  <Button
                    variant="secondary"
                    class="mt-3 self-start h-8 px-3 py-1.5"
                    onClick={() => {
                      const run = ++dialogRun
                      void import("./dialog-select-server").then((x) => {
                        if (dialogDead || dialogRun !== run) return
                        dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
                      })
                    }}
                  >
                    {language.t("status.popover.action.manageServers")}
                  </Button>
                </div>
              </div>
            </Show>
          </Tabs.Content>

          <Tabs.Content value="mcp">
            <Show when={tab() === "mcp"}>
              <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                  <Show
                    when={mcpNames().length > 0}
                    fallback={
                      <div class="text-14-regular text-text-base text-center my-auto">
                        {language.t("dialog.mcp.empty")}
                      </div>
                    }
                  >
                    <For each={mcpItems()}>
                      {(entry) => {
                        const status = () => entry.status?.status
                        const enabled = () => status() === "connected"
                        return (
                          <button
                            type="button"
                            class="status-list-item flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md transition-colors text-left"
                            onClick={() => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate(entry.name)
                            }}
                            disabled={toggleMcp.isPending && toggleMcp.variables === entry.name}
                          >
                            <div
                              classList={{
                                "size-1.5 rounded-full shrink-0": true,
                                "bg-icon-success-base": status() === "connected",
                                "bg-icon-critical-base": status() === "failed",
                                "bg-border-weak-base": status() === "disabled",
                                "bg-icon-warning-base":
                                  status() === "needs_auth" || status() === "needs_client_registration",
                              }}
                            />
                            <div class="flex-1 min-w-0 text-14-regular text-text-base truncate">
                              {entry.name}
                              <Show when={entry.project}>
                                <span class="text-text-weak"> {" | "}{entry.project}</span>
                              </Show>
                            </div>
                            <div onClick={(event) => event.stopPropagation()}>
                              <Switch
                                checked={enabled()}
                                disabled={toggleMcp.isPending && toggleMcp.variables === entry.name}
                                onChange={() => {
                                  if (toggleMcp.isPending) return
                                  toggleMcp.mutate(entry.name)
                                }}
                              />
                            </div>
                          </button>
                        )
                      }}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Tabs.Content>

          <Tabs.Content value="lsp">
            <Show when={tab() === "lsp"}>
              <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                  <Show
                    when={lspItems().length > 0}
                    fallback={
                      <div class="text-14-regular text-text-base text-center my-auto">
                        {language.t("dialog.lsp.empty")}
                      </div>
                    }
                  >
                    <For each={lspItems()}>
                      {(item) => (
                        <div class="flex items-center gap-2 w-full px-2 py-1">
                          <div
                            classList={{
                              "size-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": item.status === "connected",
                              "bg-icon-critical-base": item.status === "error",
                            }}
                          />
                          <span class="text-14-regular text-text-base truncate">{item.name || item.id}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <Show when={tab() === "plugins"}>
              <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                  <Show
                    when={plugins().length > 0}
                    fallback={<div class="text-14-regular text-text-base text-center my-auto">{pluginEmpty()}</div>}
                  >
                    <For each={plugins()}>
                      {(plugin) => (
                        <div
                          class="status-list-item flex items-center gap-2 w-full px-2 py-1 rounded-md"
                          title={plugin.value}
                        >
                          <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                          <div class="flex-1 min-w-0 text-14-regular text-text-base truncate">
                            {plugin.name}
                            <Show when={plugin.project}>
                              <span class="text-text-weak"> {" | "}{plugin.project}</span>
                            </Show>
                          </div>
                          <Button
                            size="small"
                            variant="ghost"
                            icon="copy"
                            class="shrink-0"
                            aria-label={language.t("session.header.open.copyPath")}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation()
                              copy(plugin.value)
                            }}
                          />
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <Show when={tab() === "skills"}>
              <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                  <Show
                    when={skillItems().length > 0}
                    fallback={<div class="text-14-regular text-text-base text-center my-auto">{skillEmpty()}</div>}
                  >
                    <For each={skillItems()}>
                      {(entry) => (
                        <div
                          class="status-list-item flex items-center gap-2 w-full px-2 py-1 rounded-md"
                          title={entry.value}
                        >
                          <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                          <div class="flex-1 min-w-0 text-14-regular text-text-base truncate">
                            {entry.name}
                            <span class="text-text-weak"> {" | "}{entry.scope}</span>
                            <Show when={entry.source}>
                              <span class="text-text-weak"> {" | "}{entry.source}</span>
                            </Show>
                          </div>
                          <Button
                            size="small"
                            variant="ghost"
                            icon="copy"
                            class="shrink-0"
                            aria-label={language.t("session.header.open.copyPath")}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation()
                              copy(entry.value)
                            }}
                          />
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Tabs.Content>
        </Tabs>
      </div>
    </Popover>
  )
}
