import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { renderUnicodeCompact } from "uqr"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
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
        return {
          links: server.urls.map(link),
          localhost: local ? link(local.href) : undefined,
          minutes: Math.round(pairing.expires_in / 60),
          loopback: server.urls.some((url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)),
        }
      })
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )
  const horizontal = createMemo(() => dimensions().width >= 96)
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
          <Show when={value.loopback}>
            <text fg={theme.text.muted} wrapMode="word">
              Run `opencode service set hostname 0.0.0.0` to access the service remotely.
            </text>
          </Show>
        </box>
        <box
          width={horizontal() ? undefined : "100%"}
          flexGrow={horizontal() ? 1 : 0}
          flexShrink={0}
          alignItems={horizontal() ? "flex-end" : "center"}
        >
          <Show when={value.links[0]}>
            {(url) => <text fg={theme.text.base}>{renderUnicodeCompact(url(), { border: 1 })}</text>}
          </Show>
        </box>
      </box>
    )
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          Pair
        </text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={loadError()}
        fallback={
          <Show when={info()} fallback={<text fg={theme.text.muted}>Loading server information…</text>}>
            <Show
              when={dimensions().height >= 36}
              fallback={
                <scrollbox
                  height={Math.max(8, dimensions().height - Math.floor(dimensions().height / 4) - 6)}
                  scrollbarOptions={{ visible: false }}
                >
                  {content()}
                </scrollbox>
              }
            >
              {content()}
            </Show>
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
    </box>
  )
}
