import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { renderSVG } from "uqr"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type PairingInfo } from "@/runtime/platform/platform"
import { useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { pairingUrl } from "@/servers/connect/pairing"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

export function SettingsPairing(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()
  const context = useServerCtx(() => props.server)
  const queryClient = useQueryClient()
  const key = ServerConnection.key(props.server)
  const pair = createMemo(() => {
    if (ServerConnection.builtin(props.server)) return platform.pair
    const sdk = context()
    if (!sdk) return
    const info = (value: { urls: readonly string[] }) => ({
      urls: [...new Set([props.server.http.url, ...value.urls])],
      username: "opencode" as const,
      password: props.server.http.password ?? "",
    })
    return {
      info: () => sdk.sdk.api.server.pairing.status().then(info),
      tailscaleAvailable: () => sdk.sdk.api.server.pairing.status().then((value) => value.tailscale.available),
      tailscaleStatus: () =>
        sdk.sdk.api.server.pairing
          .status()
          .then((value) => (value.tailscale.urls.length ? info({ urls: value.tailscale.urls }) : null)),
      openTailscale: () =>
        sdk.sdk.api.server.pairing.tailscale.enable().then((value) => info({ urls: value.tailscale.urls })),
      disableTailscale: () => sdk.sdk.api.server.pairing.tailscale.disable(),
    }
  })
  const local = useQuery(() => ({
    queryKey: ["pairing", key, "local"],
    queryFn: () => pair()!.info(),
    enabled: !!pair(),
  }))
  // Reading pending query data would suspend the entire settings surface.
  const localInfo = () => (local.isSuccess ? local.data : undefined)
  const localHost = createMemo(() =>
    localInfo()?.urls.find((value) => {
      const host = new URL(value).hostname
      return (
        host !== "localhost" &&
        !host.endsWith(".localhost") &&
        !host.startsWith("127.") &&
        host !== "[::1]" &&
        host !== "0.0.0.0" &&
        host !== "[::]"
      )
    }),
  )
  const screenActive = useQuery(() => ({
    queryKey: ["pairing", "screen-active"],
    queryFn: () => platform.getKeepScreenActive!(),
    enabled: ServerConnection.builtin(props.server) && !!platform.getKeepScreenActive,
  }))
  const screenActivity = useMutation(() => ({
    mutationFn: async (enabled: boolean) => platform.setKeepScreenActive?.(enabled),
    onSuccess: (_, enabled) => queryClient.setQueryData(["pairing", "screen-active"], enabled),
  }))
  const tailscale = useQuery(() => ({
    queryKey: ["pairing", key, "tailscale-available"],
    queryFn: () => pair()!.tailscaleAvailable(),
    enabled: !!pair(),
  }))
  const tailscaleStatus = useQuery(() => ({
    queryKey: ["pairing", key, "tailscale-status"],
    queryFn: () => pair()!.tailscaleStatus(),
    enabled: tailscale.isSuccess && tailscale.data === true,
  }))
  const tailscaleServe = useMutation(() => ({
    mutationFn: () => pair()!.openTailscale(),
    onSuccess: (value) => queryClient.setQueryData(["pairing", key, "tailscale-status"], value),
  }))
  const tailscaleDisable = useMutation(() => ({
    mutationFn: () => pair()!.disableTailscale(),
    onSuccess: () => queryClient.setQueryData(["pairing", key, "tailscale-status"], null),
  }))
  const tailscaleInfo = () => (tailscaleStatus.isSuccess ? tailscaleStatus.data : undefined)

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.pairing.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("pair.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={language.t("settings.pairing.connection")}>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.pairing.connection")}
              description={language.t("pair.local.description")}
            >
              <Button
                variant="neutral"
                disabled={!localHost()}
                onClick={() =>
                  dialog.push(() => (
                    <DialogPairing
                      title={language.t("settings.pairing.connection")}
                      info={localInfo()}
                      host={localHost()}
                    />
                  ))
                }
              >
                {language.t("pair.local.open")}
              </Button>
            </SettingsRow>
            <Show
              when={
                ServerConnection.builtin(props.server) && platform.getKeepScreenActive && platform.setKeepScreenActive
              }
            >
              <div data-action="settings-keep-screen-active">
                <SettingsRow
                  title={language.t("pair.screenActive.title")}
                  description={language.t("pair.screenActive.description")}
                >
                  <Switch
                    hideLabel
                    checked={screenActive.isSuccess && screenActive.data}
                    disabled={screenActive.isPending || !!screenActive.error || screenActivity.isPending}
                    onChange={(enabled) => screenActivity.mutate(enabled)}
                  >
                    {language.t("pair.screenActive.title")}
                  </Switch>
                </SettingsRow>
              </div>
            </Show>
          </SettingsList>
          <Show when={screenActive.error || screenActivity.error}>
            <p class="text-text-danger-base" role="alert">
              {language.t("pair.screenActive.error")}
            </p>
          </Show>
          <Show when={local.error}>
            <p class="text-text-danger-base" role="alert">
              {language.t("pair.error")}
            </p>
          </Show>
        </section>

        <Show when={tailscale.isSuccess && tailscale.data === true}>
          <section class="settings-section" aria-label={language.t("pair.tailscale.title")}>
            <Show
              when={tailscaleInfo()}
              fallback={
                <>
                  <h3 class="settings-section-title">{language.t("pair.tailscale.title")}</h3>
                  <SettingsList>
                    <div class="flex min-h-24 flex-col items-center justify-center gap-3 px-4 py-6">
                      <Button
                        variant="neutral"
                        disabled={!localInfo() || tailscaleStatus.isPending || tailscaleServe.isPending}
                        aria-busy={tailscaleServe.isPending}
                        onClick={() => tailscaleServe.mutate()}
                      >
                        <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <g opacity="0.3">
                            <circle cx="3" cy="3" r="3" />
                            <circle cx="12" cy="3" r="3" />
                            <circle cx="21" cy="3" r="3" />
                            <circle cx="3" cy="21" r="3" />
                            <circle cx="21" cy="21" r="3" />
                          </g>
                          <circle cx="3" cy="12" r="3" />
                          <circle cx="12" cy="12" r="3" />
                          <circle cx="21" cy="12" r="3" />
                          <circle cx="12" cy="21" r="3" />
                        </svg>
                        {language.t(tailscaleServe.isPending ? "pair.tailscale.opening" : "pair.tailscale.enable")}
                      </Button>
                      <span class="text-center text-[13px] leading-text-base text-v2-text-text-muted">
                        {language.t("pair.tailscale.description")}
                      </span>
                    </div>
                  </SettingsList>
                </>
              }
            >
              <h3 class="settings-section-title">{language.t("pair.tailscale.title")}</h3>
              <SettingsList>
                <SettingsRow
                  title={language.t("pair.tailscale.serve")}
                  description={language.t("pair.tailscale.description")}
                >
                  <div class="flex flex-col items-end gap-2">
                    <Button
                      variant="neutral"
                      disabled={!tailscaleInfo() || tailscaleDisable.isPending}
                      onClick={() =>
                        dialog.push(() => (
                          <DialogPairing
                            title={language.t("pair.tailscale.title")}
                            info={tailscaleInfo()}
                            host={tailscaleInfo()?.urls[0]}
                          />
                        ))
                      }
                    >
                      {language.t("pair.qr.open")}
                    </Button>
                    <Button
                      variant="neutral"
                      disabled={
                        !localInfo() ||
                        tailscaleStatus.isPending ||
                        tailscaleServe.isPending ||
                        tailscaleDisable.isPending
                      }
                      onClick={() => tailscaleDisable.mutate()}
                    >
                      {language.t("pair.tailscale.disable")}
                    </Button>
                  </div>
                </SettingsRow>
              </SettingsList>
            </Show>
            <Show when={tailscaleStatus.error || tailscaleServe.error || tailscaleDisable.error}>
              <p class="text-text-danger-base" role="alert">
                {language.t("pair.tailscale.error")}
              </p>
            </Show>
          </section>
        </Show>
      </div>
    </>
  )
}

function DialogPairing(props: { title: string; info: PairingInfo | null | undefined; host?: string }) {
  const language = useLanguage()
  const platform = usePlatform()
  const url = createMemo(() => {
    if (!props.info) return
    const host = props.host ?? (platform.platform === "web" ? location.origin : undefined)
    return pairingUrl(
      {
        urls: host ? [host] : props.info.urls.slice(0, 1),
        username: props.info.username,
        password: props.info.password,
      },
      host,
    )
  })
  const origin = createMemo(() => {
    const value = url()
    if (!value) return
    return new URL(value).origin
  })
  const copy = useMutation(() => ({
    mutationFn: async () => {
      const value = url()
      if (!value) return
      await (platform.writeClipboardText?.(value) ?? navigator.clipboard.writeText(value))
    },
  }))
  createEffect(() => {
    if (!copy.isSuccess) return
    const timeout = setTimeout(() => copy.reset(), 2000)
    onCleanup(() => clearTimeout(timeout))
  })
  const qr = createMemo(() => {
    const value = url()
    if (!value) return
    return renderSVG(value, { border: 4, blackColor: "currentColor", whiteColor: "transparent" })
  })

  return (
    <Dialog fit containerClass="max-w-[min(400px,calc(100vw-32px),calc(100dvh-180px))]">
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={language.t("pair.description")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-4 px-4 pb-4">
        <Show when={props.info}>
          <div
            class="aspect-square w-full shrink-0 rounded-[6px] bg-v2-background-bg-base p-6 text-v2-text-text-base [&>svg]:size-full"
            role="img"
            aria-label={language.t("pair.qr")}
            innerHTML={qr()}
          />
          <div class="flex min-w-0 justify-center pb-2">
            <Tooltip
              class="min-w-0 max-w-full"
              value={language.t(copy.isSuccess ? "common.copied" : "pair.copy")}
              placement="top"
              forceOpen={copy.isSuccess ? true : undefined}
            >
              <button
                type="button"
                class="inline-flex min-h-8 max-w-full select-none items-center justify-center gap-2 rounded-[6px] px-2 py-1 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-02 focus-visible:outline-none disabled:opacity-50"
                disabled={copy.isPending}
                aria-label={language.t("pair.copy")}
                onClick={() => copy.mutate()}
              >
                <Icon name={copy.isSuccess ? "check" : "copy"} size="small" class="shrink-0" />
                <bdi dir="ltr" class="min-w-0 break-all text-start">
                  {origin()}
                </bdi>
              </button>
            </Tooltip>
          </div>
        </Show>
        <Show when={copy.error}>
          <p class="text-text-danger-base" role="alert">
            {language.t("pair.copy.error")}
          </p>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
