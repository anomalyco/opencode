import QrScanner from "qr-scanner"
import { createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { pairingLink } from "./pairing"
import type { RedeemPairing } from "./redeem"
import {
  createScannerState,
  type ScannerEffect,
  type ScannerError,
  type ScannerEvent,
  selectScannerView,
  transitionScanner,
} from "./scanner-machine"
import "./scanner.css"

// Redeems with the form's own redeem, so the form keeps the token and a failed connection check retries without the
// spent code; the form gets back a link it can show, and fills it in.
export function PairingScanner(props: {
  redeem: RedeemPairing
  onScan: (link: string) => void
  onCancel: () => void
  camera?: typeof createCamera
}) {
  const language = useLanguage()
  const [scannerState, setScannerState] = createSignal(createScannerState())
  const view = createMemo(() => selectScannerView(scannerState()))
  const video = document.createElement("video")
  video.setAttribute("aria-label", language.t("server.connect.camera"))
  video.setAttribute("playsinline", "")
  video.muted = true

  const message = (error: ScannerError) => {
    if (error.type === "camera") return language.t("server.connect.camera.error")

    if (error.type === "invalid") return language.t("server.connect.scan.invalid")

    if (error.type === "decode") return language.t("server.connect.scan.failed")

    if (error.type === "timeout") return language.t("common.requestFailed")

    return error.message
  }

  onMount(() => {
    const cooldowns = new Map<string, ReturnType<typeof setTimeout>>()
    let redeemTimer: ReturnType<typeof setTimeout> | undefined

    const dispatch = (event: ScannerEvent) => {
      const previous = untrack(scannerState)
      const next = transitionScanner(previous, event)

      if (next.state !== previous) setScannerState(next.state)
      next.effects.forEach(run)
    }

    const run = (effect: ScannerEffect) => {
      if (effect.type === "redeem") {
        const attempt = effect.attempt
        const data = effect.data
        redeemTimer = setTimeout(() => dispatch({ type: "redeem.timed-out", attempt }), effect.timeoutMs)
        void Promise.try(() => props.redeem(data)).then(
          (redeemed) => {
            if (redeemed && "pairing" in redeemed) {
              // A QR code carries {"code","urls"} JSON; the form shows the link for the address that paired instead.
              const code = pairingLink(data)?.code
              const link = code ? new URL(`/auth/connect/${code}`, redeemed.pairing.url).href : data

              return dispatch({ type: "redeem.succeeded", attempt, link })
            }

            dispatch({
              type: "redeem.failed",
              attempt,
              error: redeemed?.error ? { type: "redeem", message: redeemed.error } : { type: "invalid" },
            })
          },
          () => dispatch({ type: "redeem.failed", attempt, error: { type: "invalid" } }),
        )

        return
      }

      if (effect.type === "redeem.timer.stop") return clearTimeout(redeemTimer)

      if (effect.type === "cooldown.start") {
        const code = effect.code
        const attempt = effect.attempt
        clearTimeout(cooldowns.get(code))
        cooldowns.set(
          code,
          setTimeout(() => dispatch({ type: "cooldown.expired", code, attempt }), effect.delayMs),
        )

        return
      }

      if (effect.type === "cooldown.clear") {
        cooldowns.forEach((handle) => clearTimeout(handle))
        cooldowns.clear()

        return
      }

      if (effect.type === "scanner.stop") return scanner.stop()

      props.onScan(effect.link)
    }

    // QrScanner hides detached videos, so initialize only after this preview is mounted.
    const scanner = (props.camera ?? createCamera)(
      video,
      (data) => dispatch({ type: "code.detected", data }),
      () => dispatch({ type: "decode.failed" }),
    )

    onCleanup(() => {
      dispatch({ type: "disposed" })
      scanner.destroy()
    })
    void scanner.start().then(
      () => dispatch({ type: "camera.ready" }),
      () => dispatch({ type: "camera.failed" }),
    )
  })

  return (
    <section class="server-connect-scanner" aria-label={language.t("server.connect.scan")}>
      <p>{language.t("server.connect.scan.description")}</p>
      <div class="server-connect-video">
        {video}
        <Show when={view().overlay}>
          {(overlay) => (
            <span role="status" data-busy={overlay() === "redeeming" ? "" : undefined}>
              {language.t(overlay() === "redeeming" ? "dialog.server.add.checking" : "server.connect.camera.starting")}
            </span>
          )}
        </Show>
      </div>
      <Show when={view().error}>
        {(error) => (
          <p class="server-connect-error" role="alert">
            {message(error())}
          </p>
        )}
      </Show>
      <Button variant="neutral" size="large" onClick={props.onCancel}>
        {language.t("common.cancel")}
      </Button>
    </section>
  )
}

function createCamera(
  video: HTMLVideoElement,
  detect: (data: string) => void,
  failed: () => void,
): Pick<QrScanner, "start" | "stop" | "destroy"> {
  const scanner = new QrScanner(video, (result) => detect(result.data), {
    preferredCamera: "environment",
    maxScansPerSecond: 10,
    returnDetailedScanResult: true,
    onDecodeError: (error) => {
      // The native BarcodeDetector engine reports an empty frame as "Scanner error: No QR code found".
      if (!String(error).includes(QrScanner.NO_QR_CODE_FOUND)) failed()
    },
  })

  // Terminal QR codes can be light-on-dark depending on the terminal theme.
  scanner.setInversionMode("both")

  return scanner
}
