import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const ready = createMemo(() => server.healthy() === false || sync.data.mcp_ready)
  const mcpIssue = createMemo(() => {
    const mcp = Object.values(sync.data.mcp ?? {})
    const failed = mcp.some((item) => item.status === "failed" || item.status === "needs_client_registration")
    const warn = mcp.some((item) => item.status === "needs_auth")
    if (failed) return "critical" as const
    if (warn) return "warning" as const
  })
  const healthy = createMemo(() => server.healthy() === true && !mcpIssue())

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
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
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
                      <Tooltip value={tooltipValue()} placement="top" inactive={!truncated()}>
                        <button
                          type="button"
                          class="flex items-center gap-2 w-full h-8 pl-3 pr-1.5 py-1.5 rounded-md transition-colors text-left"
                          classList={{
                            "opacity-50": isBlocked(),
                            "hover:bg-surface-raised-base-hover": !isBlocked(),
                            "cursor-not-allowed": isBlocked(),
                          }}
                          aria-disabled={isBlocked()}
                          onClick={() => {
                            if (isBlocked()) return
                            server.setActive(url)
                            navigate("/")
                          }}
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
                    {(item) => {
                      const enabled = () => item.status === "connected"
                      return (
                        <button
                          type="button"
                          class="flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                          onClick={() => toggleMcp(item.name)}
                          disabled={store.loading === item.name}
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
                          <span class="text-14-regular text-text-base truncate flex-1">{item.name}</span>
                          <div onClick={(event) => event.stopPropagation()}>
                            <Switch
                              checked={enabled()}
                              disabled={store.loading === item.name}
                              onChange={() => toggleMcp(item.name)}
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
                      <div class="flex items-center gap-2 w-full px-2 py-1">
                        <div class="size-1.5 rounded-full shrink-0 bg-icon-success-base" />
                        <span class="text-14-regular text-text-base truncate">{plugin}</span>
                      </div>
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
