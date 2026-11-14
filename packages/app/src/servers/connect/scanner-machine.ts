/** How long a code that failed is skipped while it stays in view. */
export const SCANNER_COOLDOWN_MS = 3_000

/** How long one redemption may run; above the pairing redeem's own worst case of about 11 s. */
export const SCANNER_REDEEM_TIMEOUT_MS = 15_000

/** Why the last scan did not pair. Each one stays shown until a new code starts redeeming. */
export type ScannerScanError =
  | { readonly type: "invalid" }
  | { readonly type: "decode" }
  | { readonly type: "timeout" }
  | { readonly type: "redeem"; readonly message: string }

export type ScannerError = ScannerScanError | { readonly type: "camera" }

/**
 * The QR pairing scanner. `cooldowns` maps each code that failed to the attempt that failed it, so a later failure of
 * the same code restarts its cooldown and an older timer cannot end it early. Attempts come from `issued`.
 */
export type ScannerState =
  | { readonly status: "starting"; readonly issued: number }
  | {
      readonly status: "scanning"
      readonly issued: number
      readonly cooldowns: Readonly<Record<string, number>>
      readonly error?: ScannerScanError
    }
  | {
      readonly status: "redeeming"
      readonly issued: number
      readonly attempt: number
      readonly code: string
      readonly cooldowns: Readonly<Record<string, number>>
    }
  /** The camera did not start. */
  | { readonly status: "failed" }
  /** A code paired; the form took over. */
  | { readonly status: "done" }
  | { readonly status: "disposed" }

export type ScannerEvent =
  | { readonly type: "camera.ready" }
  | { readonly type: "camera.failed" }
  | { readonly type: "code.detected"; readonly data: string }
  /** The decoder failed on a frame for a reason other than finding no code. */
  | { readonly type: "decode.failed" }
  | { readonly type: "redeem.succeeded"; readonly attempt: number; readonly link: string }
  | { readonly type: "redeem.failed"; readonly attempt: number; readonly error: ScannerScanError }
  | { readonly type: "redeem.timed-out"; readonly attempt: number }
  | { readonly type: "cooldown.expired"; readonly code: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type ScannerEffect =
  /** Starts the attempt's timeout, then redeems the code. */
  | { readonly type: "redeem"; readonly attempt: number; readonly data: string; readonly timeoutMs: number }
  | { readonly type: "redeem.timer.stop" }
  | { readonly type: "cooldown.start"; readonly code: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cooldown.clear" }
  | { readonly type: "scanner.stop" }
  | { readonly type: "complete"; readonly link: string }

export type ScannerTransition = { readonly state: ScannerState; readonly effects: readonly ScannerEffect[] }

export type ScannerView = {
  readonly overlay: "starting" | "redeeming" | undefined
  readonly error: ScannerError | undefined
}

const NONE: readonly ScannerEffect[] = []

export function createScannerState(): ScannerState {
  return { status: "starting", issued: 0 }
}

export function transitionScanner(state: ScannerState, event: ScannerEvent): ScannerTransition {
  if (state.status === "disposed" || state.status === "done") return { state, effects: NONE }

  if (event.type === "disposed") {
    if (state.status === "scanning") return { state: { status: "disposed" }, effects: [{ type: "cooldown.clear" }] }

    if (state.status === "redeeming")
      return { state: { status: "disposed" }, effects: [{ type: "redeem.timer.stop" }, { type: "cooldown.clear" }] }

    return { state: { status: "disposed" }, effects: NONE }
  }

  if (state.status === "starting") {
    if (event.type === "camera.ready")
      return { state: { status: "scanning", issued: state.issued, cooldowns: {} }, effects: NONE }

    if (event.type === "camera.failed") return { state: { status: "failed" }, effects: [{ type: "scanner.stop" }] }

    return { state, effects: NONE }
  }

  if (state.status === "failed") return { state, effects: NONE }

  if (event.type === "cooldown.expired") {
    if (state.cooldowns[event.code] !== event.attempt) return { state, effects: NONE }
    const cooldowns = Object.fromEntries(Object.entries(state.cooldowns).filter(([code]) => code !== event.code))

    return { state: { ...state, cooldowns }, effects: NONE }
  }

  if (state.status === "scanning") {
    if (event.type === "code.detected") {
      if (event.data in state.cooldowns) return { state, effects: NONE }
      const attempt = state.issued + 1

      return {
        state: { status: "redeeming", issued: attempt, attempt, code: event.data, cooldowns: state.cooldowns },
        effects: [{ type: "redeem", attempt, data: event.data, timeoutMs: SCANNER_REDEEM_TIMEOUT_MS }],
      }
    }

    // A redemption's error stays readable; a frame that fails to decode only reports when nothing else is shown.
    if (event.type === "decode.failed" && state.error === undefined)
      return { state: { ...state, error: { type: "decode" } }, effects: NONE }

    return { state, effects: NONE }
  }

  if (!("attempt" in event) || event.attempt !== state.attempt) return { state, effects: NONE }

  if (event.type === "redeem.succeeded")
    return {
      state: { status: "done" },
      effects: [
        { type: "redeem.timer.stop" },
        { type: "cooldown.clear" },
        { type: "scanner.stop" },
        { type: "complete", link: event.link },
      ],
    }

  if (event.type !== "redeem.failed" && event.type !== "redeem.timed-out") return { state, effects: NONE }

  // A code that failed usually stays in view, so it is skipped for a while instead of redeemed on every frame. It is
  // tried again afterwards: a code the server could not be reached for still works once the network is back.
  return {
    state: {
      status: "scanning",
      issued: state.issued,
      cooldowns: { ...state.cooldowns, [state.code]: state.attempt },
      error: event.type === "redeem.failed" ? event.error : { type: "timeout" },
    },
    effects: [
      ...(event.type === "redeem.failed" ? [{ type: "redeem.timer.stop" } as const] : NONE),
      { type: "cooldown.start", code: state.code, attempt: state.attempt, delayMs: SCANNER_COOLDOWN_MS },
    ],
  }
}

export function selectScannerView(state: ScannerState): ScannerView {
  if (state.status === "starting") return { overlay: "starting", error: undefined }

  if (state.status === "redeeming") return { overlay: "redeeming", error: undefined }

  if (state.status === "scanning") return { overlay: undefined, error: state.error }

  if (state.status === "failed") return { overlay: undefined, error: { type: "camera" } }

  return { overlay: undefined, error: undefined }
}
