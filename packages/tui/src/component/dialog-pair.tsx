import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { renderUnicodeCompact } from "uqr"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { errorMessage } from "../util/error"

export type DialogPairCredentials = {
  readonly username: string
  readonly password: string
}

export function DialogPair(props: { credentials?: DialogPairCredentials }) {
  const client = useClient()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const [loadError, setLoadError] = createSignal<unknown>()
  const [showPassword, setShowPassword] = createSignal(false)
  const [passwordHover, setPasswordHover] = createSignal(false)

  dialog.setSize("large")
  dialog.setCentered(true)

  const [server] = createResource(() =>
    client.api.server
      .get()
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )
  const info = createMemo(() => {
    const current = server()
    if (!current) return
    return {
      urls: current.urls,
      username: props.credentials?.username ?? "opencode",
      password: props.credentials?.password ?? "",
    }
  })
  const horizontal = createMemo(() => dimensions().width >= 96)
  const content = () => {
    const value = info()
    if (!value) return
    return (
      <box
        flexDirection={horizontal() ? "row" : "column"}
        alignItems={horizontal() ? "flex-start" : "center"}
        gap={2}
      >
        <box width={horizontal() ? 29 : "100%"} flexShrink={0} gap={1}>
          <box>
            <text fg={theme.textMuted}>URLs</text>
            <For each={value.urls}>{(url) => <text fg={theme.text}>{url}</text>}</For>
          </box>
          <box>
            <text fg={theme.textMuted}>Username</text>
            <text fg={theme.text}>{value.username}</text>
          </box>
          <box>
            <text fg={theme.textMuted}>Password</text>
            <text
              fg={passwordHover() ? theme.text : theme.textMuted}
              wrapMode="word"
              onMouseOver={() => setPasswordHover(true)}
              onMouseOut={() => setPasswordHover(false)}
              onMouseUp={() => setShowPassword((current) => !current)}
            >
              {showPassword() ? value.password : "************"}
            </text>
          </box>
          <Show
            when={value.urls.some((url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))}
          >
            <text fg={theme.textMuted} wrapMode="word">
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
          <text fg={theme.text}>{renderUnicodeCompact(JSON.stringify(value), { border: 1 })}</text>
        </box>
      </box>
    )
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Pair
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={loadError()}>
        {(error) => <text fg={theme.error}>{errorMessage(error())}</text>}
      </Show>
      <Show when={info()} fallback={<text fg={theme.textMuted}>Loading server information...</text>}>
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
    </box>
  )
}
