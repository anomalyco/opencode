import QrScanner from "qr-scanner"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { decodePairingCode } from "./pairing"

export function PairingScanner(props: {
  onScan: (value: NonNullable<ReturnType<typeof decodePairingCode>>) => void
  onCancel: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ error: "", ready: false })
  const video = document.createElement("video")
  video.setAttribute("aria-label", language.t("server.connect.camera"))
  video.setAttribute("playsinline", "")
  video.muted = true

  onMount(() => {
    // QrScanner hides detached videos, so initialize only after this preview is mounted.
    const scanner = new QrScanner(
      video,
      (result) => {
        const pairing = decodePairingCode(result.data)
        if (!pairing) {
          setState("error", language.t("server.connect.scan.invalid"))
          return
        }
        scanner.stop()
        props.onScan(pairing)
      },
      { preferredCamera: "environment", maxScansPerSecond: 10, returnDetailedScanResult: true },
    )
    // Terminal QR codes can be light-on-dark depending on the terminal theme.
    scanner.setInversionMode("both")
    onCleanup(() => scanner.destroy())
    void scanner.start().then(
      () => setState("ready", true),
      () => setState("error", language.t("server.connect.camera.error")),
    )
  })

  return (
    <section class="server-connect-scanner" aria-label={language.t("server.connect.scan")}>
      <p>{language.t("server.connect.scan.description")}</p>
      <div class="server-connect-video">
        {video}
        <Show when={!state.ready && !state.error}>
          <span role="status">{language.t("server.connect.camera.starting")}</span>
        </Show>
      </div>
      <Show when={state.error}>
        <p class="server-connect-error" role="alert">
          {state.error}
        </p>
      </Show>
      <Button variant="neutral" size="large" onClick={props.onCancel}>
        {language.t("common.cancel")}
      </Button>
    </section>
  )
}
