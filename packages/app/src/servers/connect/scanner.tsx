import QrScanner from "qr-scanner"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { pairingLink } from "./pairing"
import type { RedeemPairing } from "./redeem"
import "./scanner.css"

// Redeems with the form's own redeem, so the form keeps the token and a failed connection check retries without the
// spent code; the form gets back a link it can show, and fills it in.
export function PairingScanner(props: { redeem: RedeemPairing; onScan: (link: string) => void; onCancel: () => void }) {
  const language = useLanguage()
  const [state, setState] = createStore({ error: "", ready: false, redeeming: false })
  const video = document.createElement("video")
  video.setAttribute("aria-label", language.t("server.connect.camera"))
  video.setAttribute("playsinline", "")
  video.muted = true

  onMount(() => {
    // A code that failed usually stays in view, so skip it for a few seconds instead of redeeming it on every frame.
    // It is tried again afterwards: a code the server could not be reached for still works once the network is back.
    const rejected = new Map<string, number>()
    const scan = { disposed: false }

    // QrScanner hides detached videos, so initialize only after this preview is mounted.
    const scanner = new QrScanner(
      video,
      (result) => {
        if (state.redeeming || Date.now() < (rejected.get(result.data) ?? 0)) return
        setState({ redeeming: true, error: "" })
        void props.redeem(result.data).then((redeemed) => {
          if (scan.disposed) return
          setState("redeeming", false)

          if (redeemed && "pairing" in redeemed) {
            scanner.stop()
            // A QR code carries {"code","urls"} JSON; the form shows the link for the address that paired instead.
            const code = pairingLink(result.data)?.code
            props.onScan(code ? new URL(`/auth/connect/${code}`, redeemed.pairing.url).href : result.data)

            return
          }

          rejected.set(result.data, Date.now() + 3000)
          setState("error", redeemed?.error ?? language.t("server.connect.scan.invalid"))
        })
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 10,
        returnDetailedScanResult: true,
        // QrScanner only logs a decoder that fails (for example, a worker the page may not start), so the preview
        // would look like it is still scanning.
        onDecodeError: (error) => {
          // The native BarcodeDetector engine reports an empty frame as "Scanner error: No QR code found".
          if (String(error).includes(QrScanner.NO_QR_CODE_FOUND) || state.redeeming) return
          setState("error", language.t("server.connect.scan.failed"))
        },
      },
    )

    // Terminal QR codes can be light-on-dark depending on the terminal theme.
    scanner.setInversionMode("both")
    onCleanup(() => {
      scan.disposed = true
      scanner.destroy()
    })
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
        <Show when={(!state.ready && !state.error) || state.redeeming}>
          <span role="status" data-busy={state.redeeming ? "" : undefined}>
            {language.t(state.redeeming ? "dialog.server.add.checking" : "server.connect.camera.starting")}
          </span>
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
