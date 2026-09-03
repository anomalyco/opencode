import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createMemo, createResource, For, Index, type JSXElement, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useMcpToggle } from "@/providers/connect/mcp"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { pluginLabels } from "@/providers/catalog/plugin"

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

export function StatusPopoverBody(props: { shown: boolean; embedded?: boolean }) {
  const data = useData()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const language = useLanguage()

  const toggleMcp = useMcpToggle(() => sdk().directory)
  const mcpServers = createMemo(() =>
    (data.location.mcp.server.list({ directory: sdk().directory }) ?? []).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
  )
  const mcpConnected = createMemo(() => mcpServers().filter((server) => server.status.status === "connected").length)
  const [pluginList] = createResource(
    () => (props.shown ? sdk().directory : undefined),
    (directory) => serverSDK.api.plugin.list({ location: { directory } }).then((result) => result.data),
  )
  const plugins = createMemo(() => pluginLabels(pluginList.latest ?? []))
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "opencode.json"))

  return (
    <div
      class="flex items-center gap-1 rounded-xl"
      classList={{
        "w-[360px] shadow-[var(--shadow-lg-border-base)]": !props.embedded,
        "w-full min-w-0": props.embedded,
      }}
    >
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-active="mcp"
        defaultValue="mcp"
        variant="underline"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
          <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
            {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}
            {language.t("status.popover.tab.mcp")}
          </Tabs.Trigger>
          {/* TODO: Restore LSP status when V2 exposes it. */}
          <Tabs.Trigger value="plugins" data-slot="tab" class="text-12-regular">
            {pluginCount() > 0 ? `${pluginCount()} ` : ""}
            {language.t("status.popover.tab.plugins")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="mcp">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={mcpServers().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto">{language.t("dialog.mcp.empty")}</div>
                }
              >
                <Index each={mcpServers()}>
                  {(server) => {
                    const name = () => server().name
                    const status = () => server().status.status
                    const enabled = () => status() === "connected"
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full min-h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                        onClick={() => {
                          if (toggleMcp.isPending) return
                          toggleMcp.mutate(name())
                        }}
                        disabled={toggleMcp.isPending && toggleMcp.variables === name()}
                      >
                        <div
                          classList={{
                            "size-1.5 rounded-full shrink-0": true,
                            "bg-icon-success-base": status() === "connected",
                            "bg-icon-critical-base": status() === "failed",
                            "bg-border-weak-base": status() === "disabled",
                            "bg-icon-warning-base": status() === "needs_auth",
                          }}
                        />
                        <span class="flex flex-col min-w-0 flex-1">
                          <span class="flex items-center gap-2 min-w-0">
                            <span class="text-14-regular text-text-base truncate">{name()}</span>
                          </span>
                          <Show when={status() === "needs_auth"}>
                            <span class="text-11-regular text-text-weaker truncate">
                              {language.t("mcp.auth.clickToAuthenticate")}
                            </span>
                          </Show>
                        </span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            appearance="standard"
                            checked={enabled()}
                            disabled={toggleMcp.isPending && toggleMcp.variables === name()}
                            onChange={() => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate(name())
                            }}
                          />
                        </div>
                      </button>
                    )
                  }}
                </Index>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="plugins">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">
              <Show
                when={plugins().length > 0}
                fallback={<div class="text-14-regular text-text-base text-center my-auto">{pluginEmpty()}</div>}
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
  )
}
