import QrScanner from "qr-scanner"
import { createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { pairingLink } from "./pairing"
import type { RedeemPairing } from "./redeem"
import {
  createScannerState,
  type ScannerEffect,
  type ScannerEvent,
  selectScannerView,
  transitionScanner,
} from "./scanner-machine"
import { PairingScannerView } from "./scanner-view"

// Redeems with the form's own redeem, so the form keeps the token and a failed connection check retries without the
// spent code; the form gets back a link it can show, and fills it in.
export function PairingScanner(props: { redeem: RedeemPairing; onScan: (link: string) => void; onCancel: () => void }) {
  const language = useLanguage()
  const [scannerState, setScannerState] = createSignal(createScannerState())
  const view = createMemo(() => selectScannerView(scannerState()))
  const video = document.createElement("video")
  video.setAttribute("aria-label", language.t("server.connect.camera"))
  video.setAttribute("playsinline", "")
  video.muted = true

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
    const scanner = new QrScanner(video, (result) => dispatch({ type: "code.detected", data: result.data }), {
      preferredCamera: "environment",
      maxScansPerSecond: 10,
      returnDetailedScanResult: true,
      // QrScanner only logs a decoder that fails (for example, a worker the page may not start), so the preview
      // would look like it is still scanning.
      onDecodeError: (error) => {
        // The native BarcodeDetector engine reports an empty frame as "Scanner error: No QR code found".
        if (String(error).includes(QrScanner.NO_QR_CODE_FOUND)) return
        dispatch({ type: "decode.failed" })
      },
    })

    // Terminal QR codes can be light-on-dark depending on the terminal theme.
    scanner.setInversionMode("both")
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
    <PairingScannerView view={view()} onCancel={props.onCancel}>
      {video}
    </PairingScannerView>
  )
}
