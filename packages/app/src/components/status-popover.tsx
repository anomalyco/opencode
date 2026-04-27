import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createResource, createSignal, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { claude, item, label, mcp, parse, skill } from "@/components/status-popover-data"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { cachedSkills, loadSkills } from "@/utils/skills"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"

const pollMs = 10_000

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
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
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

    void refresh()
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

const useMcpToggleMutation = () => {
  const sync = useSync()
  const sdk = useSDK()
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
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
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
  const health = useServerHealth(servers, shown)
  const sortedServers = createMemo(() => listServersByHealth(servers(), server.key, health))
  const toggleMcp = useMcpToggleMutation()
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
  const [rawSkills] = createResource(
    () => (shown() ? sdk.directory : null),
    async (dir) => {
      if (!dir) return []
      const list = await loadSkills(sdk)
      console.debug("[status-popover] skills.ready", { dir, count: list.length })
      return list
    },
  )

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

        const [nextProject, nextProjectDir, nextClaude, nextOmo] = await Promise.all([
          project?.path ? read(project.path).catch(() => null) : Promise.resolve(null),
          projectDir?.path ? read(projectDir.path).catch(() => null) : Promise.resolve(null),
          read(`${global.data.path.home}/.claude.json`).catch(() => null),
          read(`${global.data.path.config}/oh-my-openagent.json`).catch(() =>
            read(`${global.data.path.config}/oh-my-openagent.jsonc`).catch(() => null),
          ),
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
  const plugins = createMemo(() => (sync.data.config.plugin ?? []).map(item))
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "opencode.json"))
  const skills = createMemo(() => rawSkills() ?? cachedSkills(sdk.directory) ?? [])
  const skillItems = createMemo(() =>
    skills()
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
  const healthy = createMemo(() => server.healthy() === true && !mcpIssue())

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
              "bg-icon-success-base": ready() && healthy(),
              "bg-icon-warning-base": ready() && server.healthy() === true && mcpIssue() === "warning",
              "bg-icon-critical-base":
                server.healthy() === false || (ready() && server.healthy() === true && mcpIssue() === "critical"),
              "bg-border-weak-base": server.healthy() === undefined || !ready(),
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
          data-active="servers"
          defaultValue="servers"
          variant="alt"
        >
          <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
            <Tabs.Trigger value="servers" data-slot="tab" class="text-12-regular">
              {serverCount() > 0 ? `${serverCount()} ` : ""}
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
            <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <For each={sortedServers()}>
                  {(url) => {
                    const isActive = () => url === server.url
                    const isDefault = () => url === store.defaultServerUrl
                    const status = () => store.status[url]
                    const isBlocked = () => status()?.healthy === false
                    const [truncated, setTruncated] = createSignal(false)
                    let nameRef: HTMLSpanElement | undefined
                    let versionRef: HTMLSpanElement | undefined

                    onMount(() => {
                      const check = () => {
                        const nameTruncated = nameRef ? nameRef.scrollWidth > nameRef.clientWidth : false
                        const versionTruncated = versionRef ? versionRef.scrollWidth > versionRef.clientWidth : false
                        setTruncated(nameTruncated || versionTruncated)
                      }
                      check()
                      window.addEventListener("resize", check)
                      onCleanup(() => window.removeEventListener("resize", check))
                    })

                    const tooltipValue = () => {
                      const name = serverDisplayName(url)
                      const version = status()?.version
                      return (
                        <span class="flex items-center gap-2">
                          <span>{name}</span>
                          <Show when={version}>
                            <span class="text-text-invert-base">{version}</span>
                          </Show>
                        </span>
                      )
                    }

                    return (
                      <button
                        type="button"
                        class="status-list-item flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                        classList={{
                          "cursor-not-allowed": isBlocked(),
                        }}
                        aria-disabled={isBlocked()}
                        onClick={() => {
                          if (isBlocked()) return
                          navigate("/")
                          queueMicrotask(() => server.setActive(key))
                        }}
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
                          <div
                            classList={{
                              "size-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": status()?.healthy === true,
                              "bg-icon-critical-base": status()?.healthy === false,
                              "bg-border-weak-base": status() === undefined,
                            }}
                          />
                          <span ref={nameRef} class="text-14-regular text-text-base truncate">
                            {serverDisplayName(url)}
                          </span>
                          <Show when={status()?.version}>
                            <span ref={versionRef} class="text-12-regular text-text-weak truncate">
                              {status()?.version}
                            </span>
                          </Show>
                          <Show when={isDefault()}>
                            <span class="text-11-regular text-text-base bg-surface-base px-1.5 py-0.5 rounded-md">
                              {language.t("common.default")}
                            </span>
                          </Show>
                          <div class="flex-1" />
                          <Show when={isActive()}>
                            <Icon name="check" size="small" class="text-icon-weak shrink-0" />
                          </Show>
                        </button>
                      </Tooltip>
                    )
                  }}
                </For>

                <Button
                  variant="secondary"
                  class="mt-3 self-start h-8 px-3 py-1.5"
                  onClick={() => dialog.show(() => <DialogSelectServer />, refreshDefaultServerUrl)}
                >
                  {language.t("status.popover.action.manageServers")}
                </Button>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="mcp">
            <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={mcpItems().length > 0}
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
                              "bg-icon-success-base": item.status === "connected",
                              "bg-icon-critical-base": item.status === "failed",
                              "bg-border-weak-base": item.status === "disabled",
                              "bg-icon-warning-base":
                                item.status === "needs_auth" || item.status === "needs_client_registration",
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
          </Tabs.Content>

          <Tabs.Content value="lsp">
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
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={plugins().length > 0}
                  fallback={
                    <div class="text-14-regular text-text-base text-center my-auto">
                      {(() => {
                        const value = language.t("dialog.plugins.empty")
                        const file = "opencode.json"
                        const parts = value.split(file)
                        if (parts.length === 1) return value
                        return (
                          <>
                            {parts[0]}
                            <code class="bg-surface-raised-base px-1.5 py-0.5 rounded-sm text-text-base">{file}</code>
                            {parts.slice(1).join(file)}
                          </>
                        )
                      })()}
                    </div>
                  }
                >
                  <For each={plugins()}>
                    {(plugin) => (
                      <Tooltip
                        class="w-full"
                        value={<span class="font-mono text-12-regular whitespace-nowrap">{plugin.value}</span>}
                        contentStyle={{ "max-width": "none" }}
                      >
                        <div class="status-list-item flex items-center gap-2 w-full px-2 py-1 rounded-md">
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
                      </Tooltip>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="flex flex-col px-2 pb-2 max-h-[calc(100vh-120px)] overflow-y-auto">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
                <Show
                  when={skillItems().length > 0}
                  fallback={<div class="text-14-regular text-text-base text-center my-auto">{skillEmpty()}</div>}
                >
                  <For each={skillItems()}>
                    {(entry) => (
                      <Tooltip
                        class="w-full"
                        value={<span class="font-mono text-12-regular whitespace-nowrap">{entry.value}</span>}
                        contentStyle={{ "max-width": "none" }}
                      >
                        <div class="status-list-item flex items-center gap-2 w-full px-2 py-1 rounded-md">
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
                      </Tooltip>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </Popover>
  )
}
