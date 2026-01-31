import { Component, For, Show, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Tag } from "@opencode-ai/ui/tag"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import type { McpStatus } from "@opencode-ai/sdk/v2/client"

// Helper to check if an MCP status indicates missing OAuth credentials
const isAuthError = (status: McpStatus): boolean =>
  status.status === "needs_auth" || (status.status === "failed" && status.error?.includes("No OAuth state saved"))

export const SettingsMcp: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  // State for tracking ongoing operations (using createStore per style guide)
  const [store, setStore] = createStore({
    loading: null as string | null,
  })

  // Fetch MCP status and config from API
  const [mcpStatus, { refetch: refetchStatus }] = createResource(async () => {
    const result = await globalSDK.client.mcp.status()
    return result.data ?? {}
  })

  const [mcpConfig] = createResource(async () => {
    const result = await globalSDK.client.config.get()
    return result.data?.mcp ?? {}
  })

  // Helper to refetch status
  const refetch = async () => {
    await refetchStatus()
  }

  // Transform status into server list with additional metadata
  const servers = () => {
    const status = mcpStatus() ?? {}
    const config = mcpConfig() ?? {}
    return Object.entries(status)
      .map(([name, serverStatus]) => {
        const serverConfig = config[name]

        // Determine if server supports OAuth (has oauth field in config)
        const supportsOAuth = serverConfig && "oauth" in serverConfig

        // Check if server needs auth (no stored credentials)
        const needsAuth = isAuthError(serverStatus)

        // Check if authenticated (has stored OAuth credentials)
        // A server has credentials if:
        // 1. It's connected (implies successful auth), OR
        // 2. It's disabled but supports OAuth and doesn't need auth
        const isAuthenticated =
          supportsOAuth && (serverStatus.status === "connected" || (serverStatus.status === "disabled" && !needsAuth))

        return {
          name,
          status: serverStatus,
          supportsOAuth,
          isAuthenticated,
          needsAuth,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const handleAuthenticate = async (name: string) => {
    if (store.loading) return
    setStore("loading", name)
    try {
      // Enable the server first if it's disabled, so auth can connect it
      const currentStatus = mcpStatus()?.[name]
      if (currentStatus?.status === "disabled") {
        await globalSDK.client.mcp.connect({ name })
      }

      const result = await globalSDK.client.mcp.auth.authenticate({ name })

      // Auth succeeded if status is "connected" OR "disabled" (disabled means auth worked but server is turned off)
      if (result.data && (result.data.status === "connected" || result.data.status === "disabled")) {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.mcp.toast.authenticated.title", { server: name }),
          description: language.t("settings.mcp.toast.authenticated.description", { server: name }),
        })
        await refetch()
      } else if (result.data && result.data.status === "needs_client_registration") {
        showToast({
          variant: "error",
          title: language.t("settings.mcp.toast.needsRegistration.title"),
          description: result.data.error,
        })
      } else if (result.data && result.data.status === "failed") {
        showToast({
          variant: "error",
          title: language.t("settings.mcp.toast.authFailed.title"),
          description: result.data.error || language.t("common.unknownError"),
        })
      } else {
        showToast({
          variant: "error",
          title: language.t("settings.mcp.toast.authFailed.title"),
          description: language.t("common.unknownError"),
        })
      }
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setStore("loading", null)
    }
  }

  const handleLogout = async (name: string) => {
    if (store.loading) return
    setStore("loading", name)
    try {
      const currentStatus = mcpStatus()?.[name]
      const wasConnected = currentStatus?.status === "connected"
      const wasDisabled = currentStatus?.status === "disabled"

      // Remove OAuth credentials
      await globalSDK.client.mcp.auth.remove({ name })

      // Force status update by attempting to connect then disconnecting
      // This makes the server check for credentials and show "needs auth" state
      if (wasConnected) {
        // If it was connected, just disconnect
        await globalSDK.client.mcp.disconnect({ name })
      }

      if (wasDisabled) {
        // If it was disabled, we need to try connecting to force it to check credentials
        // It will fail with "needs auth" which updates the status correctly
        try {
          await globalSDK.client.mcp.connect({ name })
        } catch {
          // Expected to fail due to missing credentials
        }
      }

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.mcp.toast.logout.title", { server: name }),
        description: language.t("settings.mcp.toast.logout.description", { server: name }),
      })
      await refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setStore("loading", null)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.mcp.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between pb-2">
            <h3 class="text-14-medium text-text-strong">{language.t("settings.mcp.section.servers")}</h3>
            <Button size="small" variant="ghost" onClick={() => refetch()} disabled={store.loading !== null}>
              <Icon name="arrow-down-to-line" class="size-4 rotate-[135deg]" />
              {language.t("settings.mcp.button.refresh")}
            </Button>
          </div>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={servers().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">{language.t("settings.mcp.servers.empty")}</div>
              }
            >
              <For each={servers()}>
                {(server) => (
                  <McpServerRow
                    server={server}
                    loading={store.loading === server.name}
                    onAuthenticate={handleAuthenticate}
                    onLogout={handleLogout}
                  />
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

type McpServerRowProps = {
  server: {
    name: string
    status: McpStatus
    supportsOAuth: boolean
    isAuthenticated: boolean
    needsAuth: boolean
  }
  loading?: boolean
  onAuthenticate: (name: string) => void
  onLogout: (name: string) => void
}

const McpServerRow: Component<McpServerRowProps> = (props) => {
  const language = useLanguage()

  return (
    <div class="flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-14-medium text-text-strong truncate">{props.server.name}</span>
        <Show when={props.server.isAuthenticated}>
          <Tag>
            <Icon name="check" class="size-3" />
            {language.t("settings.mcp.auth.authenticated")}
          </Tag>
        </Show>
        <Show when={props.server.status.status === "failed" && !isAuthError(props.server.status)}>
          {(() => {
            const status = props.server.status
            if (status.status !== "failed") return null
            return (
              <span class="text-12-regular text-text-weak truncate" title={status.error}>
                {status.error}
              </span>
            )
          })()}
        </Show>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <Show when={props.server.supportsOAuth}>
          <Show
            when={props.server.isAuthenticated}
            fallback={
              <Button
                size="large"
                variant="secondary"
                onClick={() => props.onAuthenticate(props.server.name)}
                disabled={props.loading}
              >
                {language.t("settings.mcp.button.authenticate")}
              </Button>
            }
          >
            <Button
              size="large"
              variant="secondary"
              onClick={() => props.onAuthenticate(props.server.name)}
              disabled={props.loading}
            >
              {language.t("settings.mcp.button.reauthenticate")}
            </Button>
            <Button
              size="large"
              variant="secondary"
              onClick={() => props.onLogout(props.server.name)}
              disabled={props.loading}
            >
              {language.t("settings.mcp.button.logout")}
            </Button>
          </Show>
        </Show>
      </div>
    </div>
  )
}
