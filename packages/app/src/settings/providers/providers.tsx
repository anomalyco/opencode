import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { useDialog } from "@opencode/ui/context/dialog"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { showToast } from "@/shell/notifications/toast"
import { popularProviders, useProviders } from "@/providers/catalog/providers"
import { useIntegrations } from "@/providers/catalog/integrations"
import { createMemo, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { CONSOLE_INTEGRATION } from "@/providers/connect/controller"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { SettingsList } from "@/settings/list"
import "@/settings/settings.css"

type ProviderSource = "env" | "api" | "account" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

const PROVIDER_ICON_SIZE = 16

export const SettingsProviders: Component<{
  directory: string | undefined
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const providers = useProviders(() => props.directory)
  const integrations = useIntegrations(() => props.directory)
  const providerConnect = useProviderConnectController()
  // Console-managed providers (`opencode-go`, `console-*`) connect through the `opencode`
  // integration, so the lookup must follow `integrationID` rather than the provider id.
  const integration = (item: ProviderItem) => {
    const id = item.integrationID ?? item.id
    return integrations.list().find((entry) => entry.id === id)
  }

  const connect = (provider?: string) => {
    providerConnect.select(provider)
    void dialog.show(() => <DialogConnectProvider directory={props.directory} controller={providerConnect} />)
  }

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter(
        (provider) =>
          provider.id !== "opencode" || Object.values(provider.models).some((model) => model.cost.input > 0),
      )
      .toSorted((a, b) => Number(b.id === "opencode-go") - Number(a.id === "opencode-go"))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    // The Console account (integration `opencode`) shares its id with the Zen provider. A stored API
    // key, including one imported from a v1 auth.json, makes Zen "connected" without any account, so
    // the Popular list keeps the sign-in row until the active credential is an OAuth grant. Until the
    // integration list arrives the row is still the models.dev Zen provider, so dedupe it as before.
    const console = integrations.list().find((entry) => entry.id === CONSOLE_INTEGRATION)
    const items = providers
      .popular()
      .filter((p) => {
        if (p.id !== CONSOLE_INTEGRATION || !console) return !connectedIDs.has(p.id)
        return console.connections.find((connection) => connection.type === "credential")?.method !== "oauth"
      })
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or OAuth grant, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item)
    const credential = current?.connections.find((connection) => connection.type === "credential")
    if (credential) return credential.method === "oauth" ? "account" : "api"
    if (current?.connections.some((connection) => connection.type === "env")) return "env"
    if (current) return "config"
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "account") return language.t("settings.providers.tag.account")
    if (current === "config") return language.t("settings.providers.tag.config")
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => {
    const current = integration(item)
    if (current) return current.connections.some((connection) => connection.type === "credential")
    const currentSource = source(item)
    return currentSource !== "env" && currentSource !== "config"
  }

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const disconnect = async (item: ProviderItem) => {
    const name = item.name
    const location = props.directory ? { directory: props.directory } : undefined
    await serverSdk.api.integration
      .get({ integrationID: item.integrationID ?? item.id, location })
      .then(async (integration) => {
        const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []
        if (credentials.length === 0) throw new Error(`No removable credentials found for ${name}`)
        await Promise.all(
          credentials.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })),
        )
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.providers.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.providers.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned settings-providers">
        <div class="settings-section" data-component="connected-providers-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList variant="catalog">
            <Show
              when={connected().length > 0}
              fallback={<div class="settings-provider-empty">{language.t("settings.providers.connected.empty")}</div>}
            >
              <For each={connected()}>
                {(item) => (
                  <div class="settings-provider-row group">
                    <div class="settings-provider-lead">
                      <ProviderIcon
                        id={item.id}
                        width={PROVIDER_ICON_SIZE}
                        height={PROVIDER_ICON_SIZE}
                        class="settings-provider-icon shrink-0"
                      />
                      <div class="settings-provider-main">
                        <span class="settings-provider-name truncate">{item.name}</span>
                        <Badge>{type(item)}</Badge>
                      </div>
                    </div>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="settings-provider-env-hint">
                          {language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <Button size="normal" variant="ghost-muted" onClick={() => void disconnect(item)}>
                        {language.t("common.disconnect")}
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList variant="catalog">
            <For each={popular()}>
              {(item) => (
                <div class="settings-provider-row">
                  <div class="settings-provider-lead">
                    <ProviderIcon
                      id={item.id}
                      width={PROVIDER_ICON_SIZE}
                      height={PROVIDER_ICON_SIZE}
                      class="settings-provider-icon shrink-0"
                    />
                    <div class="settings-provider-copy">
                      <div class="settings-provider-main">
                        <span class="settings-provider-name">{item.name}</span>
                        <Show when={item.id === "opencode" || item.id === "opencode-go"}>
                          <Badge>{language.t("dialog.provider.tag.recommended")}</Badge>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                  </div>
                  <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>
          </SettingsList>

          <button type="button" class="settings-providers-view-all" onClick={() => connect()}>
            {language.t("dialog.provider.viewAll")}
          </button>
        </div>
      </div>
    </>
  )
}
