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
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

export function SettingsPairing() {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const pair = platform.pair
  if (!pair) return null
  const local = useQuery(() => ({
    queryKey: ["pairing", "local"],
    queryFn: pair.info,
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
    enabled: !!platform.getKeepScreenActive,
  }))
  const screenActivity = useMutation(() => ({
    mutationFn: async (enabled: boolean) => platform.setKeepScreenActive?.(enabled),
    onSuccess: (_, enabled) => queryClient.setQueryData(["pairing", "screen-active"], enabled),
  }))

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
                      host={localHost()!}
                      code={pair.code}
                    />
                  ))
                }
              >
                {language.t("pair.local.open")}
              </Button>
            </SettingsRow>
            <Show when={platform.getKeepScreenActive && platform.setKeepScreenActive}>
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
      </div>
    </>
  )
}

function DialogPairing(props: { title: string; host: string; code: () => Promise<string> }) {
  const language = useLanguage()
  const platform = usePlatform()
  // Codes are single-use, so keep replacing the link while the dialog is open.
  const code = useQuery(() => ({
    queryKey: ["pairing", "code"],
    queryFn: props.code,
    gcTime: 0,
    refetchInterval: 60_000,
  }))
  const url = createMemo(() => {
    if (!code.isSuccess) return
    return new URL(`/auth/connect/${code.data}`, props.host).href
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
        <Show when={url()}>
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
                  {new URL(props.host).origin}
                </bdi>
              </button>
            </Tooltip>
          </div>
        </Show>
        <Show when={code.error}>
          <p class="text-text-danger-base" role="alert">
            {language.t("pair.error")}
          </p>
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
