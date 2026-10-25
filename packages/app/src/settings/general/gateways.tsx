import { Button } from "@bolt-ai/ui/button"
import { ButtonV2 } from "@bolt-ai/ui/v2/button-v2"
import { Tag } from "@bolt-ai/ui/v2/badge-v2"
import { Dialog } from "@bolt-ai/ui/dialog"
import { useDialog } from "@bolt-ai/ui/context/dialog"
import { ProviderIcon } from "@bolt-ai/ui/provider-icon"
import { TextField } from "@bolt-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@/utils/toast"
import { useProviders } from "@/hooks/use-providers"
import { createMemo, createSignal, type Accessor, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerProtocol, useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
import { SettingsListV2 } from "./parts/list"
import { gateways, gatewayProviderConfig, type CustomGateway, type Gateway } from "./gateways-catalog"
import "./settings-v2.css"

const GATEWAY_NOTES = [
  { id: "bolt", key: "dialog.provider.bolt.note" },
  { id: "openrouter", key: "dialog.provider.openrouter.note" },
  { id: "vercel", key: "dialog.provider.vercel.note" },
  { id: "kilo", key: "settings.gateways.note.kilo" },
  { id: "zoo", key: "settings.gateways.note.zoo" },
] as const

const GATEWAY_ICON_SIZE = 16

export const SettingsGatewaysV2: Component<{
  directory: Accessor<string | undefined>
  onBack?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const protocol = useServerProtocol()
  const serverSync = useServerSync()
  const providers = useProviders(props.directory)
  const providerConnect = useProviderConnectController({ onBack: props.onBack })

  const connected = createMemo(() => new Set(providers.connected().map((p) => p.id)))

  const visible = createMemo(() => gateways.filter((g) => g.kind === "catalog" || protocol() === "v1"))

  const note = (id: string) => GATEWAY_NOTES.find((item) => item.id === id)?.key

  const connect = (gateway: Gateway) => {
    if (gateway.kind === "custom") {
      void dialog.show(() => <DialogConnectGateway gateway={gateway} />)
      return
    }
    providerConnect.select(gateway.id)
    void dialog.show(() => <DialogConnectProvider directory={props.directory} controller={providerConnect} />)
  }

  const disconnect = async (gateway: Gateway) => {
    await serverSdk()
      .client.auth.remove({ providerID: gateway.id })
      .catch(() => undefined)
    if (gateway.kind === "custom") {
      const before = serverSync().data.config.disabled_providers ?? []
      const next = before.includes(gateway.id) ? before : [...before, gateway.id]
      serverSync().set("config", "disabled_providers", next)
      await serverSync()
        .updateConfig({ disabled_providers: next })
        .catch((err: unknown) => {
          serverSync().set("config", "disabled_providers", before)
          const message = err instanceof Error ? err.message : String(err)
          showToast({ title: language.t("common.requestFailed"), description: message })
          return undefined
        })
    }
    if (gateway.kind === "catalog") await serverSdk().client.global.dispose()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.disconnect.toast.disconnected.title", { provider: gateway.name }),
      description: language.t("provider.disconnect.toast.disconnected.description", { provider: gateway.name }),
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.gateways.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-providers">
        <div class="settings-v2-section" data-component="gateways-section">
          <p class="settings-v2-provider-description">{language.t("settings.gateways.description")}</p>
          <SettingsListV2>
            <For each={visible()}>
              {(gateway) => (
                <div class="settings-v2-provider-row group">
                  <div class="settings-v2-provider-lead">
                    <ProviderIcon
                      id={gateway.id}
                      width={GATEWAY_ICON_SIZE}
                      height={GATEWAY_ICON_SIZE}
                      class="settings-v2-provider-icon shrink-0"
                    />
                    <div class="settings-v2-provider-copy">
                      <div class="settings-v2-provider-main">
                        <span class="settings-v2-provider-name">{gateway.name}</span>
                        <Show when={connected().has(gateway.id)}>
                          <Tag>{language.t("settings.gateways.tag.connected")}</Tag>
                        </Show>
                      </div>
                      <Show when={note(gateway.id)}>
                        {(key) => <p class="settings-v2-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={connected().has(gateway.id)}
                    fallback={
                      <ButtonV2 size="normal" variant="neutral" icon="plus" onClick={() => connect(gateway)}>
                        {language.t("common.connect")}
                      </ButtonV2>
                    }
                  >
                    <ButtonV2 size="normal" variant="ghost-muted" onClick={() => void disconnect(gateway)}>
                      {language.t("common.disconnect")}
                    </ButtonV2>
                  </Show>
                </div>
              )}
            </For>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}

function DialogConnectGateway(props: { gateway: CustomGateway }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const [key, setKey] = createSignal("")

  const saveMutation = useMutation(() => ({
    mutationFn: async (apiKey: string) => {
      if ((await serverSdk().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      await serverSdk().client.auth.set({
        providerID: props.gateway.id,
        auth: { type: "api", key: apiKey },
      })
      const disabled = serverSync().data.config.disabled_providers ?? []
      await serverSync().updateConfig({
        provider: { [props.gateway.id]: gatewayProviderConfig(props.gateway) },
        disabled_providers: disabled.filter((id) => id !== props.gateway.id),
      })
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: props.gateway.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: props.gateway.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    const apiKey = key().trim()
    if (!apiKey) return
    saveMutation.mutate(apiKey)
  }

  return (
    <Dialog transition>
      <div class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={props.gateway.id} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">
            {language.t("settings.gateways.connect.title", { gateway: props.gateway.name })}
          </div>
        </div>
        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("settings.gateways.connect.description", { gateway: props.gateway.name })}
          </p>
          <TextField
            autofocus
            label={language.t("provider.custom.field.apiKey.label")}
            placeholder={language.t("provider.custom.field.apiKey.placeholder")}
            value={key()}
            onChange={setKey}
          />
          <Button
            class="w-auto self-start"
            type="submit"
            size="large"
            variant="primary"
            disabled={saveMutation.isPending || !key().trim()}
          >
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.connect")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
