import { Button } from "@opencode-ai/ui/button"
import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type QrScanner from "qr-scanner"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { readPairing, type PairingInfo } from "./pairing"

export function PairServer(props: { disabled: boolean; onPair: (info: PairingInfo) => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({ camera: false, reading: false, error: "" })
  let input: HTMLInputElement | undefined
  let active = true
  onCleanup(() => {
    active = false
  })

  const read = (value: string) => {
    if (!active || props.disabled) return
    const info = readPairing(value)
    if (!info) {
      setState("error", language.t("dialog.server.pair.invalid"))
      return
    }
    setState({ camera: false, error: "" })
    props.onPair(info)
  }
  const image = async (file: File) => {
    setState({ camera: false, reading: true, error: "" })
    const { default: QrScanner } = await import("qr-scanner")
    if (!active) return
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true })
    read(result.data)
  }

  return (
    <div class="settings-server-pair">
      <p class="settings-server-pair-note" dir="auto">
        {language.t("dialog.server.pair.description", { command: "opencode2 pair" })}
      </p>
      <div class="flex flex-wrap gap-2">
        <Show when={platform.platform === "web"}>
          <Button
            variant="neutral"
            disabled={props.disabled || state.reading}
            onClick={() => setState({ camera: !state.camera, error: "" })}
          >
            {language.t(state.camera ? "dialog.server.pair.stop" : "dialog.server.pair.scan")}
          </Button>
        </Show>
        <Button variant="neutral" disabled={props.disabled || state.reading} onClick={() => input?.click()}>
          {language.t(state.reading ? "dialog.server.pair.reading" : "dialog.server.pair.image")}
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="hidden"
          aria-label={language.t("dialog.server.pair.image")}
          disabled={props.disabled || state.reading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            if (!file) return
            void image(file)
              .catch(() => {
                if (active) setState("error", language.t("dialog.server.pair.imageError"))
              })
              .finally(() => {
                if (active) setState("reading", false)
              })
          }}
        />
      </div>
      <Show when={state.camera && !props.disabled}>
        <Camera
          onRead={read}
          onError={() => setState({ camera: false, error: language.t("dialog.server.pair.cameraError") })}
        />
      </Show>
      <Show when={state.error}>
        <p class="settings-server-pair-note" role="alert" dir="auto">
          {state.error}
        </p>
      </Show>
    </div>
  )
}

function Camera(props: { onRead: (value: string) => void; onError: () => void }) {
  const language = useLanguage()
  let video: HTMLVideoElement | undefined
  let scanner: QrScanner | undefined
  let active = true
  const start = async () => {
    const { default: QrScanner } = await import("qr-scanner")
    if (!active || !video) return
    scanner = new QrScanner(
      video,
      (result) => {
        if (active) props.onRead(result.data)
      },
      { returnDetailedScanResult: true, preferredCamera: "environment", maxScansPerSecond: 8 },
    )
    scanner.setInversionMode("both")
    await scanner.start()
  }
  onMount(() => {
    void start().catch(() => {
      if (active) props.onError()
    })
  })
  onCleanup(() => {
    active = false
    void scanner?.pause(true)
    scanner?.destroy()
  })
  return <video ref={video} class="settings-server-pair-video" aria-label={language.t("dialog.server.pair.camera")} />
}
