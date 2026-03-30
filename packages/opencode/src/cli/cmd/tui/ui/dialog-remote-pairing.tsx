import { TextAttributes } from "@opentui/core"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { useToast } from "./toast"
import type { RemotePairingResult } from "../context/remote"

function title(mode: RemotePairingResult["mode"]) {
  if (mode === "tailnet") return "Tailnet remote pairing"
  return "Mobile remote pairing"
}

function subtitle(mode: RemotePairingResult["mode"]) {
  if (mode === "tailnet") {
    return "Scan this QR or open a pairing URL from a phone already connected to your Tailscale tailnet. OpenCode stays bound to loopback and Tailscale Serve keeps the session private."
  }
  return "Scan this QR from your phone on the same private network to control the current session."
}

function access(mode: RemotePairingResult["mode"]) {
  if (mode === "tailnet") return "Private tailnet (Tailscale Serve)"
  return "Private LAN"
}

export function DialogRemotePairing(props: {
  initial: RemotePairingResult
  onRefresh: () => Promise<RemotePairingResult>
  onStop: () => Promise<void>
}) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [info, setInfo] = createSignal(props.initial)
  const [busy, setBusy] = createSignal<"refresh" | "stop" | undefined>()
  const [error, setError] = createSignal("")

  const qrLines = createMemo(() => info().qr.split("\n"))
  const compactDirectory = createMemo(() => {
    const value = info().directory
    if (value.length <= 72) return value
    return value.slice(0, 28) + "…" + value.slice(-40)
  })

  const refresh = async () => {
    setBusy("refresh")
    setError("")
    try {
      setInfo(await props.onRefresh())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.show({ message, variant: "error" })
    } finally {
      setBusy(undefined)
    }
  }

  const stop = async () => {
    setBusy("stop")
    setError("")
    try {
      await props.onStop()
      dialog.clear()
      toast.show({ message: "Mobile remote stopped", variant: "info" })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.show({ message, variant: "error" })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title(info().mode)}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>{subtitle(info().mode)}</text>

      <box borderStyle="single" borderColor={theme.border} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
        <For each={qrLines()}>{(line) => <text fg={theme.text}>{line || " "}</text>}</For>
      </box>

      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>Access:</span> {access(info().mode)}
      </text>
      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>Bind:</span> {info().bind}
      </text>
      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>Session:</span> {info().sessionID}
      </text>
      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>Expires:</span> {new Date(info().expiresAt).toLocaleString()}
      </text>

      <Show when={info().generatedPassword}>
        <text fg={theme.warning}>
          <span style={{ fg: theme.textMuted }}>Temporary password:</span> {info().generatedPassword}
        </text>
      </Show>

      <text fg={theme.text}>
        <span style={{ fg: theme.textMuted }}>Directory:</span> {compactDirectory()}
      </text>

      <box flexDirection="column">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Pairing URLs
        </text>
        <text fg={theme.textMuted}>Use one of these on your phone. They include the temporary token.</text>
        <For each={info().pairingURLs}>
          {(item, index) => (
            <text fg={index() === 0 ? theme.primary : theme.text}>
              {index() + 1}. {item}
            </text>
          )}
        </For>
      </box>

      <box flexDirection="column">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Base URLs
        </text>
        <text fg={theme.textMuted}>Reference only. These do not include the pairing token.</text>
        <For each={info().accessURLs}>{(item) => <text fg={theme.textMuted}>{item}</text>}</For>
      </box>

      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>

      <box flexDirection="row" justifyContent="flex-end" gap={1}>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.backgroundPanel}
          borderStyle="single"
          borderColor={theme.border}
          onMouseUp={() => {
            if (!busy()) void refresh()
          }}
        >
          <text fg={theme.text}>{busy() === "refresh" ? "refreshing…" : "refresh"}</text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.backgroundPanel}
          borderStyle="single"
          borderColor={theme.error}
          onMouseUp={() => {
            if (!busy()) void stop()
          }}
        >
          <text fg={theme.error}>{busy() === "stop" ? "stopping…" : "stop"}</text>
        </box>
      </box>
    </box>
  )
}
