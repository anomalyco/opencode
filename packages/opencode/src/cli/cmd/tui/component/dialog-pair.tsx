import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createResource, onMount, Show } from "solid-js"
import * as QRCode from "qrcode"

type PairResult = { enabled: false } | { enabled: true; hosts: string[]; link: string; qr: string }

const BLOCK = {
  WW: " ",
  WB: "▄",
  BB: "█",
  BW: "▀",
}

function renderQR(link: string): string {
  const qr = QRCode.create(link, { errorCorrectionLevel: "L" })
  const size = qr.modules.size
  const data = qr.modules.data
  const margin = 2

  const get = (r: number, c: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return false
    return Boolean(data[r * size + c])
  }

  const totalW = size + margin * 2
  const blank = BLOCK.WW.repeat(totalW)
  const lines: string[] = []

  // top margin
  for (let i = 0; i < margin / 2; i++) lines.push(blank)

  // QR rows, 2 at a time using half-block chars
  for (let r = -margin; r < size + margin; r += 2) {
    let row = ""
    for (let c = -margin; c < size + margin; c++) {
      const top = get(r, c)
      const bottom = get(r + 1, c)
      if (top && bottom) row += BLOCK.BB
      else if (top) row += BLOCK.BW
      else if (bottom) row += BLOCK.WB
      else row += BLOCK.WW
    }
    lines.push(row)
  }

  return lines.join("\n")
}

export function DialogPair() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const [data] = createResource(async () => {
    const res = await sdk.fetch(`${sdk.url}/experimental/push/pair`)
    if (!res.ok) return { enabled: false as const }
    const json = (await res.json()) as PairResult
    if (!json.enabled) return json

    const qrText = renderQR(json.link)
    return { ...json, qrText }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Pair Mobile Device
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={data.loading}>
        <text fg={theme.textMuted}>Loading pairing info...</text>
      </Show>
      <Show when={data.error}>
        <box gap={1}>
          <text fg={theme.error}>Could not load pairing info.</text>
          <text fg={theme.textMuted} wrapMode="word">
            Check that the server is reachable and try again.
          </text>
        </box>
      </Show>
      <Show when={!data.loading && !data.error && data()}>
        {(result) => (
          <Show
            when={result().enabled && result()}
            fallback={
              <box gap={1}>
                <text fg={theme.warning}>Push relay is not enabled.</text>
                <text fg={theme.textMuted} wrapMode="word">
                  Start the server with push relay options to enable mobile pairing:
                </text>
                <text fg={theme.text} wrapMode="word">
                  opencode serve --relay-url &lt;url&gt; --relay-secret &lt;secret&gt;
                </text>
              </box>
            }
          >
            {(pair) => (
              <box gap={1} alignItems="center">
                <text fg={theme.text}>{(pair() as any).qrText}</text>
                <box gap={0} alignItems="center">
                  <text fg={theme.textMuted} wrapMode="word">
                    Scan with the OpenCode Control app
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    to pair your device for push notifications.
                  </text>
                </box>
              </box>
            )}
          </Show>
        )}
      </Show>
    </box>
  )
}
