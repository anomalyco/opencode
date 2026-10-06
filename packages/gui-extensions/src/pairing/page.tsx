import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { renderSVG } from "uqr"
import { useExtension, type Live, type IpcClient } from "../sdk"
import type { Pairing } from "./contract"

type Client = IpcClient<typeof Pairing.spec>

// The page shows nothing until the main side is up, and again while it is away.
export default function PairingPage(props: { pairing: Accessor<Live<Client>> }) {
  const client = () => {
    const live = props.pairing()

    return live.status === "active" ? live.value : undefined
  }

  return <Show when={client()}>{(client) => <SettingsPairing client={client()} />}</Show>
}

function SettingsPairing(props: { client: Client }) {
  const ctx = useExtension()
  // The extension's dialogs close with it, so disabling pairing also stops the dialog's code polling.
  const dialogs = ctx.dialogs
  const queryClient = useQueryClient()

  const local = useQuery(() => ({
    queryKey: [ctx.id, "local"],
    queryFn: (input) => props.client.info({ signal: input.signal }),
  }))

  // Reading pending query data would suspend the entire settings surface.
  const localInfo = () => (local.isSuccess ? local.data : undefined)

  // Loopback URLs are useless to the scanning device, so the QR code only carries reachable addresses.
  const localHosts = createMemo(() =>
    (localInfo()?.urls ?? []).filter((value) => {
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
    queryKey: [ctx.id, "screen-active"],
    queryFn: () => props.client.screenActive(),
  }))

  const screenActivity = useMutation(() => ({
    mutationFn: (enabled: boolean) => props.client.setScreenActive(enabled),
    onSuccess: (_, enabled) => queryClient.setQueryData([ctx.id, "screen-active"], enabled),
  }))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{ctx.t("title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{ctx.t("description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={ctx.t("connection")}>
          <div data-component="settings-list">
            <Row title={ctx.t("connection")} description={ctx.t("local.description")}>
              <Button
                variant="neutral"
                disabled={localHosts().length === 0}
                onClick={() =>
                  dialogs.open(() => (
                    <DialogPairing
                      title={ctx.t("connection")}
                      host={localHosts()[0]!}
                      hosts={localHosts()}
                      code={() => props.client.code()}
                    />
                  ))
                }
              >
                {ctx.t("local.open")}
              </Button>
            </Row>
            <div data-action="settings-keep-screen-active">
              <Row title={ctx.t("screenActive.title")} description={ctx.t("screenActive.description")}>
                <Switch
                  hideLabel
                  checked={screenActive.isSuccess && screenActive.data}
                  disabled={screenActive.isPending || !!screenActive.error || screenActivity.isPending}
                  onChange={(enabled) => screenActivity.mutate(enabled)}
                >
                  {ctx.t("screenActive.title")}
                </Switch>
              </Row>
            </div>
          </div>
          <Show when={screenActive.error || screenActivity.error}>
            <p class="text-text-danger-base" role="alert">
              {ctx.t("screenActive.error")}
            </p>
          </Show>
          <Show when={local.error}>
            <p class="text-text-danger-base" role="alert">
              {ctx.t("error")}
            </p>
          </Show>
        </section>
      </div>
    </>
  )
}

/** The pending return from "Copied" to the copy label. */
type CopiedTimer = { timeout?: ReturnType<typeof setTimeout> }

function DialogPairing(props: {
  title: string
  host: string
  hosts: ReadonlyArray<string>
  code: () => Promise<string>
}) {
  const ctx = useExtension()
  const system = ctx.system

  // Codes are single-use, so keep replacing the link while the dialog is open.
  const code = useQuery(() => ({
    queryKey: [ctx.id, "code"],
    queryFn: props.code,
    gcTime: 0,
    refetchInterval: 60_000,
  }))

  const url = createMemo(() => {
    if (!code.isSuccess) return

    return new URL(`/auth/connect/${code.data}`, props.host).href
  })

  // "Copied" shows for two seconds after each copy.
  const copied: CopiedTimer = {}
  onCleanup(() => clearTimeout(copied.timeout))

  const copy = useMutation(() => ({
    mutationFn: async () => {
      const value = url()

      if (!value) return
      await system.copy(value)
    },
    onMutate: () => clearTimeout(copied.timeout),
    onSuccess: () => {
      copied.timeout = setTimeout(() => copy.reset(), 2000)
    },
  }))

  const qr = createMemo(() => {
    if (!code.isSuccess) return

    return renderSVG(JSON.stringify({ code: code.data, urls: props.hosts }), {
      border: 4,
      blackColor: "currentColor",
      whiteColor: "transparent",
    })
  })

  return (
    <Dialog fit containerClass="max-w-[min(400px,calc(100vw-32px),calc(100dvh-180px))]">
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={ctx.t("description")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-4 px-4 pb-4">
        <Show when={url()}>
          <div
            class="aspect-square w-full shrink-0 rounded-[6px] bg-v2-background-bg-base p-6 text-v2-text-text-base [&>svg]:size-full"
            role="img"
            aria-label={ctx.t("qr")}
            innerHTML={qr()}
          />
          <div class="flex min-w-0 justify-center pb-2">
            <Tooltip
              class="min-w-0 max-w-full"
              value={ctx.t(copy.isSuccess ? "common.copied" : "copy")}
              placement="top"
              forceOpen={copy.isSuccess ? true : undefined}
            >
              <button
                type="button"
                class="inline-flex min-h-8 max-w-full select-none items-center justify-center gap-2 rounded-[6px] px-2 py-1 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-02 focus-visible:outline-none disabled:opacity-50"
                disabled={copy.isPending}
                aria-label={ctx.t("copy")}
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
            {ctx.t("error")}
          </p>
        </Show>
        <Show when={copy.error}>
          <p class="text-text-danger-base" role="alert">
            {ctx.t("copy.error")}
          </p>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
