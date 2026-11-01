import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { pairingQRLink, reachableURLs } from "@opencode/util/pairing-link"
import { renderUnicodeCompact } from "@opencode/util/qr"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogHeader, DialogLayout, dialogWidth, useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import { errorMessage } from "../util/error"

export function DialogPair() {
  const client = useClient()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const theme = useTheme().surface("dialog")
  const [loadError, setLoadError] = createSignal<unknown>()

  dialog.setSize("large")
  dialog.setCentered(true)

  const [info] = createResource(() =>
    Promise.all([client.api.server.info(), client.api.server.pair()])
      .then(([server, pairing]) => {
        const link = (url: string) => new URL(`/auth/connect/${pairing.code}`, url).href
        const local = server.urls[0] ? new URL(server.urls[0]) : undefined
        if (local) local.hostname = "localhost"
        // The QR code carries only addresses the scanning device can reach, including the remote access tunnel
        // when it is on, so the phone also pairs away from this network.
        const qr = pairingQRLink(pairing.code, server.urls)
        return {
          links: server.urls.map(link),
          localhost: local ? link(local.href) : undefined,
          minutes: Math.round(pairing.expires_in / 60),
          reachable: reachableURLs(server.urls).length > 0,
          qr: qr === undefined ? undefined : renderUnicodeCompact(qr, { border: 1 }),
        }
      })
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )
  // QR rows cannot wrap, and the code grows with every address it carries, so it sits beside the links only where it
  // fits there, and is replaced by a hint where it fits nowhere.
  const qrWidth = createMemo(() => info()?.qr?.indexOf("\n") ?? 0)
  const bodyWidth = createMemo(() => Math.min(dialogWidth("large"), dimensions().width - 2) - DIALOG_INSET * 2)
  const horizontal = createMemo(() => dimensions().width >= 96 && 29 + 2 + qrWidth() <= bodyWidth())
  const content = () => {
    const value = info()
    if (!value) return
    return (
      <box flexDirection={horizontal() ? "row" : "column"} alignItems={horizontal() ? "flex-start" : "center"} gap={2}>
        <box width={horizontal() ? 29 : "100%"} flexShrink={0} gap={1}>
          <text fg={theme.text.muted} wrapMode="word">
            Open a link to connect. Links work once and expire in {value.minutes} minutes.
          </text>
          <Show when={value.localhost}>
            {(url) => (
              <box>
                <text fg={theme.text.muted}>This device</text>
                <Link href={url()} fg={theme.text.base}>
                  {url()}
                </Link>
              </box>
            )}
          </Show>
          <box>
            <text fg={theme.text.muted}>Links</text>
            <For each={value.links}>
              {(url) => (
                <Link href={url} fg={theme.text.base}>
                  {url}
                </Link>
              )}
            </For>
          </box>
          <Show when={!value.reachable}>
            <text fg={theme.text.muted} wrapMode="word">
              Run `opencode service set hostname 0.0.0.0` to pair on this network, or `opencode pair --remote` to pair
              from anywhere.
            </text>
          </Show>
          <Show when={value.reachable && !value.qr}>
            <text fg={theme.text.muted} wrapMode="word">
              The addresses are too long for a QR code; open a link instead.
            </text>
          </Show>
        </box>
        <box
          width={horizontal() ? undefined : "100%"}
          flexGrow={horizontal() ? 1 : 0}
          flexShrink={0}
          alignItems={horizontal() ? "flex-end" : "center"}
        >
          <Show when={value.qr}>
            {(qr) => (
              <Show
                when={qrWidth() <= bodyWidth()}
                fallback={
                  <text fg={theme.text.muted} wrapMode="word">
                    Widen the terminal to show the QR code.
                  </text>
                }
              >
                <text fg={theme.text.base}>{qr()}</text>
              </Show>
            )}
          </Show>
        </box>
      </box>
    )
  }

  return (
    <DialogLayout header={<DialogHeader title="Pair" />}>
      <Show
        when={loadError()}
        fallback={
          <Show when={info()} fallback={<text fg={theme.text.muted}>Loading server information…</text>}>
            {/* The QR code can be taller than the terminal, beside the links or under them, so the body scrolls. */}
            <scrollbox
              id="pair-body"
              maxHeight={Math.max(8, dimensions().height - 6)}
              scrollbarOptions={{ visible: false }}
            >
              {content()}
            </scrollbox>
          </Show>
        }
      >
        {(error) => (
          <box>
            <text fg={theme.text.feedback.error.base} attributes={TextAttributes.BOLD}>
              Could not load server information
            </text>
            <text fg={theme.text.muted}>{errorMessage(error())}</text>
            <text fg={theme.text.muted}>Close and reopen Pair to try again.</text>
          </box>
        )}
      </Show>
    </DialogLayout>
  )
}
