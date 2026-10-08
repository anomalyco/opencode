import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { RadioGroup, RadioItem } from "@opencode/ui/radio"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { renderSVG } from "uqr"
import { useExtension, type Live, type IpcClient } from "../sdk"
import type { Pairing } from "./contract"
import type definition from "./index"
import { customAddress, pairingRoutes, type PairingRoute, type RouteKind } from "./routes"

type Client = IpcClient<typeof Pairing.spec>

/**
 * The parts of the local server's `ServerRef` the page uses. The renderer passes the live ref, so `client` is read
 * on every call and follows a restarted server.
 */
export type PairingServer = {
  readonly client: {
    readonly server: {
      info(options: { signal: AbortSignal }): Promise<{ readonly urls: readonly string[] }>
      pair(options: { signal: AbortSignal }): Promise<{ readonly code: string; readonly expires_in: number }>
    }
  }
}

/** The command that lets the local server accept connections from other devices. */
const LISTEN_COMMAND = "opencode service set hostname 0.0.0.0"

export default function PairingPage(props: {
  server: Accessor<PairingServer | undefined>
  pairing: Accessor<Live<Client>>
}) {
  const ctx = useExtension<typeof definition>()
  // The extension's dialogs close with it, so disabling pairing also stops the dialog's code polling.
  const dialogs = ctx.dialogs
  const system = ctx.system
  const links = ctx.stores.links
  const queryClient = useQueryClient()
  const [custom, setCustom] = createStore({ draft: links.value.custom, invalid: false })

  const local = useQuery(() => ({
    queryKey: [ctx.id, "local"],
    queryFn: (input) => {
      const server = props.server()

      if (!server) throw new Error("The local server is not listed")

      return server.client.server.info({ signal: input.signal })
    },
    enabled: !!props.server(),
    // Asks again each time the page opens: the guidance below tells the user to change the hostname and reopen Pairing.
    gcTime: 0,
  }))

  // Reading pending query data would suspend the entire settings surface.
  const localInfo = () => (local.isSuccess ? local.data : undefined)

  // The custom address field starts with the saved address, so a valid address being typed counts at once and a cleared
  // or invalid one does not; it is saved on Enter, when the field loses focus, and when the dialog opens.
  const routes = createMemo(() => pairingRoutes(localInfo()?.urls ?? [], customAddress(custom.draft.trim()) ?? ""))

  // Whether the server itself listens only on this computer. Not derived from the routes above, so typing a custom
  // address does not remove the notice above the field while the user types.
  const listensLocally = () => local.isSuccess && pairingRoutes(local.data.urls, "").length === 0

  const code = async (signal: AbortSignal) => {
    const server = props.server()

    if (!server) throw new Error("The local server is not listed")
    const pairing = await server.client.server.pair({ signal })

    return { code: pairing.code, expiresIn: pairing.expires_in }
  }

  // Only the display setting needs pairing's main side; the link and QR code come from the server, so they never wait.
  const display = () => {
    const live = props.pairing()

    return live.status === "active" ? live : undefined
  }

  const screenActive = useQuery(() => ({
    queryKey: [ctx.id, "screen-active", display()?.generation],
    queryFn: (input) => {
      const live = display()

      if (!live) throw new Error("Pairing's main side is not active")

      return live.value.screenActive({ signal: input.signal })
    },
    enabled: !!display(),
    gcTime: 0,
  }))

  const screenActivity = useMutation(() => ({
    mutationFn: (enabled: boolean) => {
      const live = display()

      if (!live) throw new Error("Pairing's main side is not active")

      return live.value.setScreenActive(enabled)
    },
    onSuccess: (_, enabled) => queryClient.setQueryData([ctx.id, "screen-active", display()?.generation], enabled),
  }))

  // "Copied" shows for two seconds after each copy.
  const commandCopied: CopiedTimer = {}
  onCleanup(() => clearTimeout(commandCopied.timeout))

  const copyCommand = useMutation(() => ({
    mutationFn: () => system.copy(LISTEN_COMMAND),
    onMutate: () => clearTimeout(commandCopied.timeout),
    onSuccess: () => {
      commandCopied.timeout = setTimeout(() => copyCommand.reset(), 2000)
    },
  }))

  const saveCustom = () => {
    const draft = custom.draft.trim()
    const address = draft ? customAddress(draft) : ""

    if (address === undefined) return void setCustom("invalid", true)
    setCustom({ draft: address, invalid: false })

    if (address === links.value.custom) return
    links.update((value) => {
      value.custom = address

      // A new address is what the user wants to share next.
      if (address) value.selected = address
    })
  }

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
              <Show when={routes().length > 0}>
                <Button
                  variant="neutral"
                  onClick={() => {
                    saveCustom()
                    dialogs.open(() => (
                      <DialogPairing
                        title={ctx.t("connection")}
                        routes={routes}
                        selected={() => links.value.selected}
                        onSelect={(url) =>
                          links.update((value) => {
                            value.selected = url
                          })
                        }
                        code={code}
                      />
                    ))
                  }}
                >
                  {ctx.t("local.open")}
                </Button>
              </Show>
            </Row>
            <Show when={listensLocally()}>
              <div class="flex flex-col gap-2 py-4" role="status">
                <div class="flex items-center gap-2 text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                  <Icon name="lock" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  {ctx.t("unreachable.title")}
                </div>
                <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
                  {ctx.t("unreachable.description")}
                </p>
                <div class="flex min-w-0 items-center gap-2">
                  <code
                    dir="ltr"
                    class="min-w-0 truncate rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-2 py-1 text-12-mono text-v2-text-text-base"
                  >
                    {LISTEN_COMMAND}
                  </code>
                  <Tooltip
                    value={ctx.t(copyCommand.isSuccess ? "common.copied" : "unreachable.copy")}
                    placement="top"
                    forceOpen={copyCommand.isSuccess ? true : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      aria-label={ctx.t("unreachable.copy")}
                      onClick={() => copyCommand.mutate()}
                    >
                      <Icon name={copyCommand.isSuccess ? "check" : "copy"} size="small" />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </Show>
            {/* The address field spans the row so the description keeps its width. */}
            <div data-component="settings-row">
              <div data-slot="settings-row-copy">
                <div data-slot="settings-row-title">{ctx.t("custom.title")}</div>
                <div data-slot="settings-row-description">{ctx.t("custom.description")}</div>
                <TextInput
                  type="url"
                  dir="ltr"
                  spellcheck={false}
                  autocapitalize="off"
                  aria-label={ctx.t("custom.title")}
                  placeholder={ctx.t("custom.placeholder")}
                  value={custom.draft}
                  invalid={custom.invalid}
                  aria-describedby={custom.invalid ? "pairing-custom-error" : undefined}
                  onInput={(event) => setCustom({ draft: event.currentTarget.value, invalid: false })}
                  onChange={saveCustom}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveCustom()
                  }}
                />
                <Show when={custom.invalid}>
                  <span
                    id="pairing-custom-error"
                    class="text-11-regular leading-[var(--line-height-compact)] text-v2-state-fg-danger"
                    role="alert"
                  >
                    {ctx.t("custom.invalid")}
                  </span>
                </Show>
              </div>
            </div>
            <Show when={display()}>
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
            </Show>
          </div>
          <Show when={display() && (screenActive.error || screenActivity.error)}>
            <p class="text-text-danger-base" role="alert">
              {ctx.t("screenActive.error")}
            </p>
          </Show>
          <Show when={local.error || !props.server()}>
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

const routeLabel: Record<RouteKind, string> = {
  custom: "route.custom",
  local: "route.local",
  vpn: "route.vpn",
  other: "route.other",
}

const routeDescription: Record<RouteKind, string> = {
  custom: "route.custom.description",
  local: "route.local.description",
  vpn: "route.vpn.description",
  other: "route.other.description",
}

function DialogPairing(props: {
  title: string
  routes: Accessor<readonly PairingRoute[]>
  selected: Accessor<string>
  onSelect: (url: string) => void
  code: (signal: AbortSignal) => Promise<{ readonly code: string; readonly expiresIn: number }>
}) {
  const ctx = useExtension()
  const system = ctx.system

  // Codes are single-use, so replace the link as soon as the server forgets the current code.
  const code = useQuery(() => ({
    queryKey: [ctx.id, "code"],
    queryFn: (input) => props.code(input.signal),
    gcTime: 0,
    refetchInterval: (query) => (query.state.data?.expiresIn ?? 60) * 1000,
    // A minimized window must not come back to a code that expired while it was hidden.
    refetchIntervalInBackground: true,
  }))

  // The countdown is the only clock on the page.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(clock))

  const remaining = () => {
    if (!code.isSuccess) return 0

    // The clock can lag a fresh code by up to a second; a negative age would show one second too many.
    return Math.max(0, code.data.expiresIn - Math.floor(Math.max(0, now() - code.dataUpdatedAt) / 1000))
  }

  const route = createMemo(() => props.routes().find((item) => item.url === props.selected()) ?? props.routes()[0])

  const url = createMemo(() => {
    const target = route()

    if (!code.isSuccess || !target) return

    return new URL(`/auth/connect/${code.data.code}`, target.url).href
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

  // "Copied" describes the link on screen, so it ends when the user switches to another link.
  const forgetCopy = () => {
    clearTimeout(copied.timeout)
    copy.reset()
  }

  const refresh = () => (
    <button
      type="button"
      class="rounded-[4px] px-1 text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted underline-offset-2 hover:text-v2-text-text-base hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
      disabled={code.isFetching}
      onClick={() => {
        forgetCopy()
        void code.refetch()
      }}
    >
      {ctx.t("refresh")}
    </button>
  )

  // The QR code carries every address as `opencode pair` prints it, {"code","urls"} JSON, so the app's scanner can
  // reach this machine over whichever network it shares; the chosen address goes first.
  const qr = createMemo(() => {
    const target = route()

    if (!code.isSuccess || !target) return
    const urls = [target.url, ...props.routes().flatMap((item) => (item.url === target.url ? [] : [item.url]))]

    return renderSVG(JSON.stringify({ code: code.data.code, urls }), {
      border: 4,
      blackColor: "currentColor",
      whiteColor: "transparent",
    })
  })

  return (
    <Dialog fit containerClass="max-w-[min(400px,calc(100vw-32px))]">
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={ctx.t("description")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-4 px-4 pb-4">
        <Show
          when={props.routes().length > 1}
          fallback={
            <Show when={route()}>
              {(item) => (
                <div class="flex flex-col gap-0.5">
                  <span class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                    {ctx.t(routeLabel[item().kind])}
                  </span>
                  <span class="text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {ctx.t(routeDescription[item().kind])}
                  </span>
                </div>
              )}
            </Show>
          }
        >
          <RadioGroup
            hideLabel
            label={ctx.t("routes")}
            value={route()?.url}
            onChange={(url) => {
              forgetCopy()
              props.onSelect(url)
            }}
          >
            <For each={props.routes()}>
              {(item) => (
                <RadioItem
                  value={item.url}
                  label={ctx.t(routeLabel[item.kind])}
                  description={
                    <>
                      {ctx.t(routeDescription[item.kind])}
                      {" · "}
                      <bdi dir="ltr">{new URL(item.url).host}</bdi>
                    </>
                  }
                />
              )}
            </For>
          </RadioGroup>
        </Show>
        <Show when={url()}>
          <div
            class="mx-auto aspect-square w-full max-w-[min(320px,calc(100dvh-360px))] shrink-0 rounded-[6px] bg-v2-background-bg-base p-6 text-v2-text-text-base [&>svg]:size-full"
            role="img"
            aria-label={ctx.t("qr")}
            innerHTML={qr()}
          />
          <div class="flex min-w-0 flex-col items-center gap-1 pb-2">
            <Tooltip
              class="min-w-0 max-w-full"
              value={ctx.t(copy.isSuccess ? "common.copied" : "copyLink")}
              placement="top"
              forceOpen={copy.isSuccess ? true : undefined}
            >
              <button
                type="button"
                class="inline-flex min-h-8 max-w-full select-none items-center justify-center gap-2 rounded-[6px] px-2 py-1 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-02 focus-visible:outline-none disabled:opacity-50"
                disabled={copy.isPending}
                aria-label={ctx.t("copyLink")}
                onClick={() => copy.mutate()}
              >
                <Icon name={copy.isSuccess ? "check" : "copy"} size="small" class="shrink-0" />
                {/* The whole link, code included, so it can be read out or typed on a device without a camera. */}
                <bdi dir="ltr" class="min-w-0 break-all text-start text-12-mono">
                  {url()}
                </bdi>
              </button>
            </Tooltip>
            <div class="flex items-center gap-2 text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
              <span role="timer" aria-live="off">
                {ctx.t("expires", { time: countdown(remaining()) })}
              </span>
              <span aria-hidden="true">·</span>
              {refresh()}
            </div>
          </div>
        </Show>
        {/* A failed fetch hides the link, so the way to try again stays next to the error. */}
        <Show when={!url() && code.error}>
          <div class="flex flex-col items-center gap-1">
            <p class="text-text-danger-base" role="alert">
              {ctx.t("error")}
            </p>
            {refresh()}
          </div>
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

function countdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
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
