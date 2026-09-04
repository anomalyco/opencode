import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type McpStatusState =
  | "connected"
  | "pending"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"

const statusKey = (status: McpStatusState) =>
  ({
    connected: "mcp.status.connected",
    failed: "mcp.status.failed",
    needs_auth: "mcp.status.needs_auth",
    needs_client_registration: "mcp.status.needs_client_registration",
    disabled: "mcp.status.disabled",
    pending: "settings.mcp.status.pending",
  })[status]

const statusTagVariant = (status: McpStatusState) =>
  status === "connected" ? "accent" : "neutral"

export const SettingsMcpV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()

  const [busy, setBusy] = createSignal<string | undefined>()
  const [loadError, setLoadError] = createSignal<string | undefined>()

  const location = () => (props.directory ? { location: { directory: props.directory } } : {})

  const [servers, serversActions] = createResource(
    () => props.directory,
    async (directory) => {
      try {
        const result = await serverSdk().api.mcp.list(
          directory ? { location: { directory } } : undefined,
        )
        setLoadError(undefined)
        return result.data ?? []
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error))
        return []
      }
    },
  )

  const sorted = createMemo(() => [...(servers() ?? [])].sort((a, b) => a.name.localeCompare(b.name)))

  const onError = (error: unknown) =>
    showToast({ variant: "error", description: error instanceof Error ? error.message : String(error) })

  // TODO(mcp-task-3): opens the add dialog.
  const onAdd = () => {}

  // TODO(mcp-task-3): opens the edit dialog for this server.
  const onEdit = (_name: string) => {}

  const connect = async (name: string) => {
    setBusy(name)
    try {
      await serverSdk().api.mcp.connect({ server: name, ...location() })
      await serversActions.refetch()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(undefined)
    }
  }

  const disconnect = async (name: string) => {
    setBusy(name)
    try {
      await serverSdk().api.mcp.disconnect({ server: name, ...location() })
      await serversActions.refetch()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(undefined)
    }
  }

  const authenticate = async (name: string) => {
    setBusy(name)
    try {
      await serverSdk().client.mcp.auth.authenticate({ name })
      await serversActions.refetch()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (name: string) => {
    setBusy(name)
    try {
      await serverSdk().api.mcp.remove({ server: name, ...location() })
      showToast({ variant: "success", description: language.t("settings.mcp.deleted", { name }) })
      await serversActions.refetch()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(undefined)
    }
  }

  const confirmRemove = (name: string) => {
    void dialog.push(() => (
      <Dialog fit>
        <DialogHeader>
          <DialogTitleGroup
            title={language.t("settings.mcp.delete.title")}
            description={language.t("settings.mcp.delete.body", { name })}
          />
        </DialogHeader>
        <DividerV2 />
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              void remove(name)
            }}
          >
            {language.t("settings.mcp.action.delete")}
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
  }
  const actionRow = (server: { name: string; status: { status: McpStatusState } }) => (
    <div class="flex gap-2">
      <Show when={server.status.status === "connected" || server.status.status === "pending"}>
        <ButtonV2
          size="normal"
          variant="ghost-muted"
          disabled={busy() !== undefined}
          onClick={() => void disconnect(server.name)}
        >
          {language.t("settings.mcp.action.disconnect")}
        </ButtonV2>
      </Show>
      <Show
        when={
          server.status.status === "disabled" ||
          server.status.status === "failed" ||
          server.status.status === "needs_client_registration"
        }
      >
        <ButtonV2
          size="normal"
          variant="ghost-muted"
          disabled={busy() !== undefined}
          onClick={() => void connect(server.name)}
        >
          {language.t("settings.mcp.action.connect")}
        </ButtonV2>
      </Show>
      <Show when={server.status.status === "needs_auth" || server.status.status === "needs_client_registration"}>
        <ButtonV2
          size="normal"
          variant="neutral"
          disabled={busy() !== undefined}
          onClick={() => void authenticate(server.name)}
        >
          {language.t("settings.mcp.action.authenticate")}
        </ButtonV2>
      </Show>
      <ButtonV2 size="normal" variant="ghost-muted" disabled={busy() !== undefined} onClick={() => onEdit(server.name)}>
        {language.t("settings.mcp.action.edit")}
      </ButtonV2>
      <ButtonV2
        size="normal"
        variant="ghost-muted"
        disabled={busy() !== undefined}
        onClick={() => confirmRemove(server.name)}
      >
        {language.t("settings.mcp.action.delete")}
      </ButtonV2>
    </div>
  )

  return (
    <div class="settings-v2-tab-body settings-v2-plugins">
      <div class="mb-4">
        <ButtonV2 size="normal" variant="neutral" onClick={onAdd}>
          {language.t("settings.mcp.add")}
        </ButtonV2>
      </div>
      <Show
        when={!servers.loading && (servers() ?? []).length > 0}
        fallback={
          <div class="settings-v2-plugins-note">
            <Show when={!servers.loading} fallback={<>{language.t("common.loading")}{language.t("common.loading.ellipsis")}</>}>
              <Show when={!loadError()} fallback={<>{loadError()}</>}>
                {language.t("settings.mcp.empty")}
              </Show>
            </Show>
          </div>
        }
      >
        <SettingsListV2>
          <For each={sorted()}>
            {(server) => (
              <SettingsRowV2
                title={server.name}
                description={
                  <Tag variant={statusTagVariant(server.status.status)}>
                    {language.t(statusKey(server.status.status))}
                  </Tag>
                }
              >
                {actionRow(server)}
              </SettingsRowV2>
            )}
          </For>
        </SettingsListV2>
      </Show>
    </div>
  )
}