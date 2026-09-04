import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { encodeRemoteQr, REMOTE_QR_QUIET_ZONE, REMOTE_QR_SIZE, remoteQrPath } from "@/utils/remote-qr"
import { showToast } from "@/utils/toast"

type RemoteDialogProps = {
  urls: string[]
  onDisconnect: () => Promise<void>
}

export function SessionRemoteControl() {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()
  const dialog = useDialog()
  const { params } = useSessionLayout()
  const [state, setState] = createStore({ loading: false })

  const directory = createMemo(() => decode64(params.dir) ?? "")
  const localSidecar = createMemo(() => {
    const current = server.current
    return current?.type === "sidecar" && current.variant === "base"
  })
  const available = createMemo(
    () =>
      platform.platform === "desktop" &&
      !!platform.createRemotePairing &&
      !!platform.revokeRemotePairing &&
      !!params.id &&
      !!directory() &&
      localSidecar(),
  )

  const fail = (reason?: "no-lan") => {
    showToast({
      variant: "error",
      title: language.t("session.remote.error.title"),
      description: language.t(
        reason === "no-lan" ? "session.remote.error.noLan" : "session.remote.error.description",
      ),
    })
  }

  const open = async () => {
    const sessionID = params.id
    const cwd = directory()
    if (state.loading || !available() || !platform.createRemotePairing || !sessionID || !cwd) return

    setState("loading", true)
    try {
      const pairing = await platform.createRemotePairing(sessionID, cwd)
      const urls = pairing.urls.length > 0 ? pairing.urls : [pairing.url]
      dialog.show(() => (
        <RemoteControlDialog
          urls={urls}
          onDisconnect={async () => {
            if (!platform.revokeRemotePairing) throw new Error("remote_revoke_unavailable")
            await platform.revokeRemotePairing(sessionID, cwd)
          }}
        />
      ))
    } catch (error) {
      fail(error instanceof Error && error.message.includes("No local network address") ? "no-lan" : undefined)
    } finally {
      setState("loading", false)
    }
  }

  return (
    <Show when={available()}>
      <Tooltip placement="bottom" value={language.t("session.remote.title")}>
        <Button
          type="button"
          variant="ghost"
          class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
          disabled={state.loading}
          onClick={() => void open()}
          aria-label={language.t("session.remote.open")}
        >
          <Show when={!state.loading} fallback={<Spinner class="size-3.5" />}>
            <Icon name="share" size="small" />
          </Show>
        </Button>
      </Tooltip>
    </Show>
  )
}

function RemoteControlDialog(props: RemoteDialogProps) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({ copying: false, disconnecting: false, index: 0 })
  const size = REMOTE_QR_SIZE + REMOTE_QR_QUIET_ZONE * 2
  const url = createMemo(() => props.urls[state.index] ?? props.urls[0]!)
  const modules = createMemo(() => encodeRemoteQr(url()))
  const path = createMemo(() => remoteQrPath(modules(), REMOTE_QR_QUIET_ZONE))

  const copy = async () => {
    if (state.copying) return
    setState("copying", true)
    try {
      await navigator.clipboard.writeText(url())
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.remote.linkCopied"),
      })
    } catch {
      showToast({
        variant: "error",
        title: language.t("session.remote.error.title"),
        description: language.t("session.remote.error.description"),
      })
    } finally {
      setState("copying", false)
    }
  }

  const disconnect = async () => {
    if (state.disconnecting) return
    setState("disconnecting", true)
    try {
      await props.onDisconnect()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.remote.disconnected"),
      })
      dialog.close()
    } catch {
      showToast({
        variant: "error",
        title: language.t("session.remote.error.title"),
        description: language.t("session.remote.error.description"),
      })
    } finally {
      setState("disconnecting", false)
    }
  }

  return (
    <Dialog title={language.t("session.remote.title")} description={language.t("session.remote.description")}>
      <div class="flex flex-col gap-4 min-w-0">
        <div class="flex justify-center rounded-lg bg-white p-3 self-center">
          <svg
            class="size-56 max-w-full"
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={language.t("session.remote.open")}
            shape-rendering="crispEdges"
          >
            <rect width={size} height={size} fill="white" />
            <path d={path()} fill="black" />
          </svg>
        </div>

        <p class="text-12-regular text-text-weak text-center">{language.t("session.remote.networkNote")}</p>
        <Show when={props.urls.length > 1}>
          <div class="flex flex-wrap items-center justify-center gap-1.5">
            <For each={props.urls}>
              {(item, index) => (
                <Button
                  type="button"
                  size="small"
                  variant={state.index === index() ? "secondary" : "ghost"}
                  aria-pressed={state.index === index()}
                  onClick={() => setState("index", index())}
                >
                  {new URL(item).hostname}
                </Button>
              )}
            </For>
          </div>
        </Show>
        <code class="block max-w-[420px] overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-surface-raised-base px-3 py-2 text-11-regular text-text-weak">
          {url()}
        </code>

        <div class="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => void copy()} disabled={state.copying}>
            <Show when={!state.copying} fallback={<Spinner class="size-3.5" />}>
              <Icon name="copy" size="small" />
            </Show>
            {language.t("session.remote.copyLink")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void disconnect()} disabled={state.disconnecting}>
            <Show when={!state.disconnecting} fallback={<Spinner class="size-3.5" />}>
              <Icon name="close-small" size="small" />
            </Show>
            {language.t("session.remote.disconnect")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
