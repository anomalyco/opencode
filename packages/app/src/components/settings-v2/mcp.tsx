import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { For, Show, createMemo, createResource, createSignal, type Component } from "solid-js"
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { buildAddInput, emptyForm, formFromConfig, storedToPayloadConfig, type McpFormState, type McpServerConfig } from "./mcp-payload"
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
    pending: "mcp.status.pending",
  })[status]

const statusTagVariant = (status: McpStatusState) =>
  status === "connected" ? "accent" : "neutral"

export const SettingsMcpV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const protocol = useServerProtocol()

  const [busy, setBusy] = createSignal<string | undefined>()
  const [loadError, setLoadError] = createSignal<string | undefined>()

  const location = () => (props.directory ? { location: { directory: props.directory } } : {})
  const directory = () => (props.directory ? { directory: props.directory } : undefined)

  // The MCP surface used here is the SDK client's `/mcp` routes (status/add/
  // connect/disconnect), NOT the promise client's `/api/mcp*` — the desktop
  // sidecar (in-tree server) does not expose `/api/mcp`, and upstream's own
  // loadMcpQuery/toggleMcp call `legacy.mcp.status()` and `sdk.mcp.*` on both
  // protocols. Removal has no dedicated route: it unsets `mcp[name]` in the
  // global config. The promise client's mcp routes only exist on genuine
  // 1.17-era servers; fall back to them only when the SDK client fails with a
  // route error (defense in depth for real v1 servers).
  const mcpApi = () => {
    const sdk = serverSdk()
    return {
      list: async () => {
        // Protocol is undefined while detection is in flight; the SDK `/mcp`
        // route is the safe default (the promise client's `/api/mcp` only
        // exists on genuine 1.17-era servers and hangs/404s elsewhere).
        if (protocol() !== "v2") {
          // Matches server-sync.tsx loadMcpQuery v1 path: legacy.mcp.status()
          const status = await sdk.client.mcp.status(directory())
          return Object.entries(status).map(([name, value]) => ({ name, status: { status: value.status } }))
        }
        const result = await sdk.api.mcp.list(
          props.directory ? { location: { directory: props.directory } } : undefined,
        )
        return result.data ?? []
      },
      add: async (server: string, config: McpServerConfig) => {
        // The v2 schema wants mutable arrays; the payload builder types them readonly.
        const mutable = (config.type === "local"
          ? { ...config, command: [...config.command] }
          : { ...config }) as McpLocalConfig | McpRemoteConfig
        try {
          await sdk.client.mcp.add({ name: server, config: mutable, ...directory() })
        } catch (error) {
          if (protocol() === "v2") throw error
          await sdk.api.mcp.add({ server, config, ...location() })
        }
      },
      remove: async (server: string) => {
        const config = serverSync().data.config
        const next = { ...config, mcp: { ...config?.mcp } }
        delete next.mcp[server]
        try {
          await sdk.client.global.config.update({ config: next })
        } catch (error) {
          if (protocol() === "v2") throw error
          await sdk.api.mcp.remove({ server, ...location() })
        }
      },
      connect: async (server: string) => {
        try {
          await sdk.client.mcp.connect({ name: server, ...directory() })
        } catch (error) {
          if (protocol() === "v2") throw error
          await sdk.api.mcp.connect({ server, ...location() })
        }
      },
      disconnect: async (server: string) => {
        try {
          await sdk.client.mcp.disconnect({ name: server, ...directory() })
        } catch (error) {
          if (protocol() === "v2") throw error
          await sdk.api.mcp.disconnect({ server, ...location() })
        }
      },
    }
  }

  const [servers, serversActions] = createResource(
    // A resource source of `undefined` would skip the fetcher entirely, so use a
    // constant source and branch the location inside.
    () => true,
    async () => {
      try {
        const result = await mcpApi().list()
        setLoadError(undefined)
        return result
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error))
        return []
      }
    },
  )

  const sorted = createMemo(() => [...(servers() ?? [])].sort((a, b) => a.name.localeCompare(b.name)))

  const onError = (error: unknown) =>
    showToast({ variant: "error", description: error instanceof Error ? error.message : String(error) })

  const addServer = async (form: McpFormState, previous?: { name: string; wasConnected: boolean }) => {
    const built = buildAddInput(form, { keepSecret: previous !== undefined })
    if (!built.ok) throw new Error(built.error)
    const api = mcpApi()
    if (previous) {
      if (previous.wasConnected) {
        await api.disconnect(previous.name).catch(() => undefined)
      }
      await api.remove(previous.name)
    }
    await api.add(built.input.server, built.input.config)
  }

  const openForm = (initial: McpFormState, previous?: { name: string; wasConnected: boolean }) => {
    // A reactive store keeps the dialog's toggles, switches, and row editors
    // updating as the form is mutated (a plain object would render once and
    // freeze every non-text control).
    const [form] = createStore<McpFormState>({ ...initial, environment: [...initial.environment], headers: [...initial.headers] })
    void dialog.push(() => (
      <Dialog fit>
        <DialogHeader>
          <DialogTitleGroup
            title={language.t(previous ? "settings.mcp.form.title.edit" : "settings.mcp.form.title.add")}
            description={language.t("settings.mcp.form.subtitle")}
          />
        </DialogHeader>
        <DividerV2 />
        <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2">
          <McpFormFields form={form} previous={previous} />
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("settings.mcp.form.cancel")}
          </ButtonV2>
          <McpFormSave
            form={form}
            previous={previous}
            existingNames={() => (servers() ?? []).map((server) => server.name)}
            onSave={async () => {
              await addServer(form, previous)
              await serversActions.refetch()
            }}
            onClose={() => dialog.close()}
          />
        </DialogFooter>
      </Dialog>
    ))
  }

  const onAdd = () => openForm(emptyForm())

  const onEdit = (name: string) => {
    const existing = serverSync().data.config?.mcp?.[name]
    if (!existing || !("type" in existing)) {
      showToast({ variant: "error", description: language.t("settings.mcp.errors.noConfig", { name }) })
      return
    }
    const config = storedToPayloadConfig(existing)
    const status = (servers() ?? []).find((server) => server.name === name)?.status.status
    openForm(formFromConfig(name, config), { name, wasConnected: status === "connected" })
  }

  const connect = async (name: string) => {
    setBusy(name)
    try {
      await mcpApi().connect(name)
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
      await mcpApi().disconnect(name)
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
      await serverSdk().client.mcp.auth.authenticate({
        name,
        ...(props.directory ? { directory: props.directory } : {}),
      })
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
      await mcpApi().remove(name)
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
    <>
      <div class="settings-v2-tab-header settings-v2-plugins-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.mcp")}</h2>
          <div class="flex items-center gap-2">
            <ButtonV2 size="normal" variant="neutral" onClick={onAdd}>
              {language.t("settings.mcp.add")}
            </ButtonV2>
          </div>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-plugins">
        <Show
          when={!servers.loading && (servers() ?? []).length > 0}
          fallback={
            <div class="settings-v2-plugins-note">
              <Show when={!servers.loading} fallback={<>{language.t("common.loading")}{language.t("common.loading.ellipsis")}</>}>
                <Show when={!loadError()} fallback={<>{language.t("settings.mcp.errors.refresh")} {loadError()}</>}>
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
    </>
  )
}
const McpFormFields: Component<{
  form: McpFormState
  previous?: { name: string; wasConnected: boolean }
}> = (props) => {
  const language = useLanguage()

  const label = "text-sm font-medium"
  const field = "flex flex-col gap-1"

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.previous?.wasConnected}>
        <div class="settings-v2-plugins-note">{language.t("settings.mcp.edit.warn")}</div>
      </Show>
      <div class={field}>
        <label class={label}>{language.t("settings.mcp.form.name")}</label>
        <TextInputV2
          type="text"
          value={props.form.name}
          disabled={props.previous !== undefined}
          onInput={(event) => (props.form.name = event.currentTarget.value)}
        />
      </div>
      <div class="flex gap-2">
        <ButtonV2
          size="normal"
          variant={props.form.kind === "local" ? "neutral" : "ghost-muted"}
          onClick={() => (props.form.kind = "local")}
        >
          {language.t("settings.mcp.type.local")}
        </ButtonV2>
        <ButtonV2
          size="normal"
          variant={props.form.kind === "remote" ? "neutral" : "ghost-muted"}
          onClick={() => (props.form.kind = "remote")}
        >
          {language.t("settings.mcp.type.remote")}
        </ButtonV2>
      </div>
      <Show when={props.form.kind === "local"}>
        <div class={field}>
          <label class={label}>{language.t("settings.mcp.form.command")}</label>
          <TextInputV2
            type="text"
            value={props.form.command.join(" ")}
            placeholder={language.t("settings.mcp.form.command.hint")}
            onInput={(event) => (props.form.command = event.currentTarget.value.split(" ").filter((part) => part !== ""))}
          />
        </div>
        <div class={field}>
          <label class={label}>{language.t("settings.mcp.form.cwd")}</label>
          <TextInputV2 type="text" value={props.form.cwd} onInput={(event) => (props.form.cwd = event.currentTarget.value)} />
        </div>
        <KeyValueRows
          label={language.t("settings.mcp.form.env")}
          rows={() => props.form.environment}
          onChange={(rows) => (props.form.environment = rows)}
        />
      </Show>
      <Show when={props.form.kind === "remote"}>
        <div class={field}>
          <label class={label}>{language.t("settings.mcp.form.url")}</label>
          <TextInputV2
            type="text"
            value={props.form.url}
            placeholder="https://mcp.example.com/mcp"
            onInput={(event) => (props.form.url = event.currentTarget.value)}
          />
        </div>
        <KeyValueRows
          label={language.t("settings.mcp.form.headers")}
          rows={() => props.form.headers}
          onChange={(rows) => (props.form.headers = rows)}
        />
        <div class="flex items-center gap-2">
          <Switch
            checked={props.form.oauthEnabled}
            onChange={(value) => (props.form.oauthEnabled = value)}
          />
          <label class={label}>{language.t("settings.mcp.form.oauth")}</label>
        </div>
        <Show when={props.form.oauthEnabled}>
          <div class="flex items-center gap-2">
            <Switch
              checked={props.form.oauthDisableAutodetect}
              onChange={(value) => (props.form.oauthDisableAutodetect = value)}
            />
            <label class={label}>{language.t("settings.mcp.form.oauth.disableAutodetect")}</label>
          </div>
          <Show when={!props.form.oauthDisableAutodetect}>
            <div class="flex flex-col gap-2">
              <div class={field}>
                <label class={label}>{language.t("settings.mcp.form.oauth.clientId")}</label>
                <TextInputV2
                  type="text"
                  value={props.form.clientId}
                  onInput={(event) => (props.form.clientId = event.currentTarget.value)}
                />
              </div>
              <div class={field}>
                <label class={label}>{language.t("settings.mcp.form.oauth.clientSecret")}</label>
                <TextInputV2
                  type="password"
                  value={props.form.clientSecret}
                  placeholder={
                    props.form.clientSecretPlaceholder
                      ? language.t("settings.mcp.form.oauth.clientSecret.keep")
                      : undefined
                  }
                  onInput={(event) => (props.form.clientSecret = event.currentTarget.value)}
                />
              </div>
              <div class={field}>
                <label class={label}>{language.t("settings.mcp.form.oauth.scope")}</label>
                <TextInputV2
                  type="text"
                  value={props.form.scope}
                  onInput={(event) => (props.form.scope = event.currentTarget.value)}
                />
              </div>
              <div class={field}>
                <label class={label}>{language.t("settings.mcp.form.oauth.callbackPort")}</label>
                <TextInputV2
                  type="text"
                  value={props.form.callbackPort}
                  onInput={(event) => (props.form.callbackPort = event.currentTarget.value)}
                />
              </div>
            </div>
          </Show>
        </Show>
      </Show>
      <div class="flex items-center gap-2">
        <Switch checked={props.form.enabled} onChange={(value) => (props.form.enabled = value)} />
        <label class={label}>{language.t("settings.mcp.form.enabled")}</label>
      </div>
      <div class={field}>
        <label class={label}>{language.t("settings.mcp.form.timeout")}</label>
        <TextInputV2
          type="text"
          value={props.form.timeout}
          placeholder="5000"
          onInput={(event) => (props.form.timeout = event.currentTarget.value)}
        />
      </div>
    </div>
  )
}

const KeyValueRows: Component<{
  label: string
  rows: () => { key: string; value: string }[]
  onChange: (rows: { key: string; value: string }[]) => void
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">{props.label}</label>
      <For each={props.rows()}>
        {(row, index) => (
          <div class="flex items-center gap-2">
            <TextInputV2
              type="text"
              class="w-40"
              value={row.key}
              onInput={(event) => {
                const next = [...props.rows()]
                next[index()] = { ...next[index()], key: event.currentTarget.value }
                props.onChange(next)
              }}
            />
            <TextInputV2
              type="text"
              class="flex-1"
              value={row.value}
              onInput={(event) => {
                const next = [...props.rows()]
                next[index()] = { ...next[index()], value: event.currentTarget.value }
                props.onChange(next)
              }}
            />
            <ButtonV2
              size="normal"
              variant="ghost-muted"
              onClick={() => props.onChange(props.rows().filter((_, i) => i !== index()))}
            >
              {language.t("settings.mcp.form.removeRow")}
            </ButtonV2>
          </div>
        )}
      </For>
      <ButtonV2
        size="normal"
        variant="outline"
        onClick={() => props.onChange([...props.rows(), { key: "", value: "" }])}
      >
        {language.t("settings.mcp.form.addRow")}
      </ButtonV2>
    </div>
  )
}

const McpFormSave: Component<{
  form: McpFormState
  previous?: { name: string; wasConnected: boolean }
  existingNames: () => string[]
  onSave: () => Promise<void>
  onClose: () => void
}> = (props) => {
  const language = useLanguage()
  const [saving, setSaving] = createSignal(false)
  const [fieldError, setFieldError] = createSignal<string | undefined>()

  const errorText = (field: string | undefined) => {
    if (field === undefined) return undefined
    if (["name", "command", "url", "callbackPort", "timeout"].includes(field)) {
      return language.t(`settings.mcp.form.error.${field}`)
    }
    return language.t("settings.mcp.errors.invalid")
  }

  const save = async () => {
    const built = buildAddInput(props.form, { keepSecret: props.previous !== undefined })
    if (!built.ok) {
      setFieldError(built.error)
      return
    }
    // The server's add endpoint upserts; guard the add flow against replacing an
    // existing server (edits pass `previous` and intentionally re-add).
    if (!props.previous && props.existingNames().includes(built.input.server)) {
      setFieldError("name")
      showToast({ variant: "error", description: language.t("settings.mcp.errors.duplicate") })
      return
    }
    setSaving(true)
    setFieldError(undefined)
    try {
      await props.onSave()
      props.onClose()
    } catch (error) {
      showToast({ variant: "error", description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="flex items-center gap-2">
      <Show when={fieldError()}>
        <span class="text-text-muted-base">{errorText(fieldError())}</span>
      </Show>
      <ButtonV2 variant="neutral" disabled={saving()} onClick={() => void save()}>
        {language.t("settings.mcp.form.save")}
      </ButtonV2>
    </div>
  )
}
