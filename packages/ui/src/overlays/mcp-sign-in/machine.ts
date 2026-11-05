/** Delay between OAuth status polls while the attempt is pending or the server is unreachable. */
export const MCP_SIGN_IN_POLL_MS = 1_000

/** How long the MCP server and resource sync after a sign-in may run before it shows a retryable error. */
export const MCP_SIGN_IN_SYNC_TIMEOUT_MS = 30_000

/** The server's answer to a status poll of the sign-in attempt. */
export type McpSignInAttemptStatus =
  | { readonly status: "pending" | "complete" | "expired" }
  | { readonly status: "failed"; readonly message: string }

export type McpSignInPollOutcome =
  | { readonly status: "pending" }
  | { readonly status: "complete" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "expired" }
  /** The status request threw; the attempt may still be open on the server until its lifetime ends. */
  | { readonly status: "unreachable"; readonly message: string }

export type McpSignInEntryError =
  | { readonly type: "required" }
  | { readonly type: "rejected"; readonly message: string }

export type McpSignInFailure =
  | { readonly type: "auth-expired" }
  | { readonly type: "auth-failed"; readonly message: string }
  /** The sign-in succeeded, but reloading the MCP lists failed; a retry reloads them again. */
  | { readonly type: "sync-failed"; readonly message: string }
  | { readonly type: "sync-timed-out" }

/**
 * An MCP sign-in that also accepts the redirect URL pasted from the browser. Requests take attempt numbers from
 * `issued`, so a result whose attempt the state no longer holds is stale.
 */
export type McpSignInState =
  | {
      readonly status: "waiting"
      readonly url: string
      readonly issued: number
      readonly pollAttempt: number
      readonly value: string
      /** The server accepted a pasted redirect URL and finishes the sign-in; the status poll reports the outcome. */
      readonly pasteAccepted: boolean
      readonly entryError: McpSignInEntryError | undefined
      /** The last status request failed; shown if the attempt's lifetime ends before the server answers again. */
      readonly unreachableError: string | undefined
    }
  | {
      readonly status: "submitting"
      readonly url: string
      readonly issued: number
      readonly pollAttempt: number
      readonly submitAttempt: number
      readonly value: string
      readonly unreachableError: string | undefined
    }
  /** The sign-in succeeded; the MCP server and resource lists reload before the dialog closes. */
  | { readonly status: "completing"; readonly url: string; readonly issued: number; readonly syncAttempt: number }
  | { readonly status: "failed"; readonly url: string; readonly issued: number; readonly failure: McpSignInFailure }
  | { readonly status: "done" }
  | { readonly status: "disposed" }

export type McpSignInEvent =
  | { readonly type: "browser.open" }
  | { readonly type: "paste.changed"; readonly value: string }
  | { readonly type: "paste.submitted" }
  | { readonly type: "polled"; readonly pollAttempt: number; readonly outcome: McpSignInPollOutcome }
  | { readonly type: "submit.succeeded"; readonly submitAttempt: number }
  | { readonly type: "submit.failed"; readonly submitAttempt: number; readonly message: string }
  /** The attempt's lifetime ended before the server reported an outcome. */
  | { readonly type: "waiting.timed-out" }
  | { readonly type: "sync.succeeded"; readonly syncAttempt: number }
  | { readonly type: "sync.failed"; readonly syncAttempt: number; readonly message: string }
  | { readonly type: "sync.timed-out"; readonly syncAttempt: number }
  | { readonly type: "retry.requested" }
  | { readonly type: "disposed" }

export type McpSignInEffect =
  | { readonly type: "deadline.start"; readonly delayMs: number }
  | { readonly type: "deadline.clear" }
  /** Aborts the poll in flight or scheduled, then polls the attempt's status after `delayMs`. */
  | { readonly type: "poll"; readonly pollAttempt: number; readonly delayMs: number }
  | { readonly type: "poll.abort" }
  | { readonly type: "submit"; readonly submitAttempt: number; readonly code: string }
  | { readonly type: "submit.abort" }
  /** Reloads the MCP server and resource lists, reporting back within `timeoutMs`. */
  | { readonly type: "sync"; readonly syncAttempt: number; readonly timeoutMs: number }
  | { readonly type: "sync.clear" }
  /** Reloads the MCP lists without reporting back, for a sign-in the server finishes after the dialog closed. */
  | { readonly type: "refresh" }
  | { readonly type: "open-external"; readonly url: string }
  /** Ends the attempt on the server, so a late browser callback cannot connect the server. */
  | { readonly type: "cancel" }
  | { readonly type: "close" }

export type McpSignInTransition = {
  readonly state: McpSignInState
  readonly effects: readonly McpSignInEffect[]
}

export function startMcpSignIn(input: { url: string; lifetimeMs: number }): McpSignInTransition {
  return {
    state: {
      status: "waiting",
      url: input.url,
      issued: 1,
      pollAttempt: 1,
      value: "",
      pasteAccepted: false,
      entryError: undefined,
      unreachableError: undefined,
    },
    effects: [
      { type: "deadline.start", delayMs: Math.max(0, input.lifetimeMs) },
      { type: "poll", pollAttempt: 1, delayMs: 0 },
    ],
  }
}

export function transitionMcpSignIn(state: McpSignInState, event: McpSignInEvent): McpSignInTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: dispose(state) }

  if (state.status === "done") return unchanged(state)

  if (event.type === "browser.open") {
    if (!selectMcpSignInView(state).showOpenBrowser) return unchanged(state)

    return unchanged(state, [{ type: "open-external", url: state.url }])
  }

  if (state.status === "completing") return completing(state, event)

  if (state.status === "failed") {
    if (event.type !== "retry.requested") return unchanged(state)

    if (state.failure.type !== "sync-failed" && state.failure.type !== "sync-timed-out") return unchanged(state)

    return sync(state)
  }

  if (event.type === "polled") return polled(state, event)

  if (event.type === "waiting.timed-out")
    return {
      state: {
        status: "failed",
        url: state.url,
        issued: state.issued,
        failure: state.unreachableError
          ? { type: "auth-failed", message: state.unreachableError }
          : { type: "auth-expired" },
      },
      // An accepted paste is the server's to finish; cancelling it could drop a sign-in that is about to succeed.
      effects: [...stop(state), ...(state.status === "waiting" && state.pasteAccepted ? [] : [cancel])],
    }

  if (state.status === "submitting") {
    if (event.type === "submit.succeeded" && event.submitAttempt === state.submitAttempt) {
      const pollAttempt = state.issued + 1

      // Polls at once instead of a tick later, so the dialog moves on as soon as the server finishes.
      return {
        state: {
          status: "waiting",
          url: state.url,
          issued: pollAttempt,
          pollAttempt,
          value: state.value,
          pasteAccepted: true,
          entryError: undefined,
          unreachableError: state.unreachableError,
        },
        effects: [{ type: "poll", pollAttempt, delayMs: 0 }],
      }
    }

    if (event.type === "submit.failed" && event.submitAttempt === state.submitAttempt)
      return unchanged({
        status: "waiting",
        url: state.url,
        issued: state.issued,
        pollAttempt: state.pollAttempt,
        value: state.value,
        pasteAccepted: false,
        entryError: { type: "rejected", message: event.message },
        unreachableError: state.unreachableError,
      })

    return unchanged(state)
  }

  if (state.pasteAccepted) return unchanged(state)

  if (event.type === "paste.changed") {
    if (event.value === state.value && state.entryError === undefined) return unchanged(state)

    return unchanged({ ...state, value: event.value, entryError: undefined })
  }

  if (event.type !== "paste.submitted") return unchanged(state)

  const code = state.value.trim()

  if (!code) return unchanged({ ...state, entryError: { type: "required" } })

  const submitAttempt = state.issued + 1

  return {
    state: {
      status: "submitting",
      url: state.url,
      issued: submitAttempt,
      pollAttempt: state.pollAttempt,
      submitAttempt,
      value: state.value,
      unreachableError: state.unreachableError,
    },
    effects: [{ type: "submit", submitAttempt, code }],
  }
}

export function selectMcpSignInView(state: McpSignInState) {
  const failure = state.status === "failed" ? state.failure : undefined
  const canRetry = failure?.type === "sync-failed" || failure?.type === "sync-timed-out"
  const showForm = state.status === "waiting" || state.status === "submitting"
  const locked = state.status === "submitting" || (state.status === "waiting" && state.pasteAccepted)

  return {
    status: state.status,
    failure,
    canRetry,
    // Once the server reports the sign-in done, the browser has nothing left to do.
    showOpenBrowser: showForm || failure?.type === "auth-expired" || failure?.type === "auth-failed",
    showForm,
    value: showForm ? state.value : "",
    entryError: state.status === "waiting" ? state.entryError : undefined,
    locked,
    submitting: state.status === "submitting",
  }
}

export type McpSignInView = ReturnType<typeof selectMcpSignInView>

const cancel: McpSignInEffect = { type: "cancel" }

function polled(
  state: Extract<McpSignInState, { status: "waiting" | "submitting" }>,
  event: Extract<McpSignInEvent, { type: "polled" }>,
): McpSignInTransition {
  if (event.pollAttempt !== state.pollAttempt) return unchanged(state)
  const outcome = event.outcome

  // A failed request says nothing about the attempt, which may still be pending, so polling goes on until it expires.
  if (outcome.status === "pending" || outcome.status === "unreachable") {
    const pollAttempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: pollAttempt,
        pollAttempt,
        unreachableError: outcome.status === "unreachable" ? outcome.message : undefined,
      },
      effects: [{ type: "poll", pollAttempt, delayMs: MCP_SIGN_IN_POLL_MS }],
    }
  }

  if (outcome.status === "complete") {
    const next = sync(state)

    return { state: next.state, effects: [...stop(state), ...next.effects] }
  }

  return {
    state: {
      status: "failed",
      url: state.url,
      issued: state.issued,
      failure:
        outcome.status === "expired" ? { type: "auth-expired" } : { type: "auth-failed", message: outcome.message },
    },
    effects: stop(state),
  }
}

function completing(
  state: Extract<McpSignInState, { status: "completing" }>,
  event: McpSignInEvent,
): McpSignInTransition {
  if (event.type !== "sync.succeeded" && event.type !== "sync.failed" && event.type !== "sync.timed-out")
    return unchanged(state)

  if (event.syncAttempt !== state.syncAttempt) return unchanged(state)

  if (event.type === "sync.succeeded")
    return { state: { status: "done" }, effects: [{ type: "sync.clear" }, { type: "close" }] }

  return {
    state: {
      status: "failed",
      url: state.url,
      issued: state.issued,
      failure:
        event.type === "sync.failed" ? { type: "sync-failed", message: event.message } : { type: "sync-timed-out" },
    },
    effects: [{ type: "sync.clear" }],
  }
}

function sync(state: Exclude<McpSignInState, { status: "done" | "disposed" }>): McpSignInTransition {
  const syncAttempt = state.issued + 1

  return {
    state: { status: "completing", url: state.url, issued: syncAttempt, syncAttempt },
    effects: [{ type: "sync", syncAttempt, timeoutMs: MCP_SIGN_IN_SYNC_TIMEOUT_MS }],
  }
}

// Stops the requests and timers of a sign-in that is still waiting for the server.
function stop(state: Extract<McpSignInState, { status: "waiting" | "submitting" }>): McpSignInEffect[] {
  return [
    { type: "deadline.clear" },
    { type: "poll.abort" },
    ...(state.status === "submitting" ? [{ type: "submit.abort" } as const] : []),
  ]
}

// Like the TUI, dismissing the dialog ends an attempt still waiting, so a late browser callback cannot connect the
// server. An accepted paste or a finished sign-in already saved its credential, which still has to reach the lists.
function dispose(state: Exclude<McpSignInState, { status: "disposed" }>): McpSignInEffect[] {
  if (state.status === "waiting" || state.status === "submitting")
    return [...stop(state), state.status === "waiting" && state.pasteAccepted ? { type: "refresh" } : cancel]

  if (state.status === "completing") return [{ type: "sync.clear" }]

  return []
}

function unchanged(state: McpSignInState, effects: readonly McpSignInEffect[] = []): McpSignInTransition {
  return { state, effects }
}
