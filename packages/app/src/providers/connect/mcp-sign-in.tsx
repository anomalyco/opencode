import { createMemo, createSignal, createUniqueId, onCleanup, onMount, Show, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import {
  selectMcpSignInView,
  startMcpSignIn,
  transitionMcpSignIn,
  type McpSignInEffect,
  type McpSignInEvent,
  type McpSignInFailure,
} from "./mcp-sign-in-machine"

/**
 * Waits for an MCP sign-in that also accepts the redirect URL pasted from the browser, for when the browser
 * cannot reach the machine running the server (SSH, a remote desktop connection, a container).
 */
export function DialogMcpSignIn(props: {
  name: string
  integrationID: string
  attemptID: string
  url: string
  /** The attempt's lifetime in milliseconds, from the server's `time`; the two clocks may disagree. */
  lifetime: number
  location: { directory: string } | undefined
  /** Reloads the MCP server and resource lists once the sign-in succeeded. */
  onSync: () => Promise<void>
  onClose: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const errorID = createUniqueId()
  const attempt = { integrationID: props.integrationID, attemptID: props.attemptID, location: props.location }
  const initial = startMcpSignIn({ url: props.url, lifetimeMs: props.lifetime })
  const [signInState, setSignInState] = createSignal(initial.state)
  const view = createMemo(() => selectMcpSignInView(signInState()))

  let input: HTMLInputElement | undefined
  // The machine decides when each of these starts and stops; the driver only holds them.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let pollController: AbortController | undefined
  let submitController: AbortController | undefined

  const dispatch = (event: McpSignInEvent) => {
    const previous = untrack(signInState)
    const next = transitionMcpSignIn(previous, event)

    if (next.state !== previous) setSignInState(next.state)
    next.effects.forEach(
      (effect) => void Promise.try(() => run(effect)).catch((cause: unknown) => console.error(cause)),
    )
  }

  const run = (effect: McpSignInEffect) => {
    if (effect.type === "deadline.start") {
      clearTimeout(deadlineTimer)
      deadlineTimer = setTimeout(() => dispatch({ type: "waiting.timed-out" }), effect.delayMs)

      return
    }

    if (effect.type === "deadline.clear") return clearTimeout(deadlineTimer)

    if (effect.type === "poll") {
      abortPoll()

      if (effect.delayMs <= 0) return poll(effect.pollAttempt)
      pollTimer = setTimeout(() => poll(effect.pollAttempt), effect.delayMs)

      return
    }

    if (effect.type === "poll.abort") return abortPoll()

    if (effect.type === "submit") {
      submitController?.abort()
      const controller = new AbortController()
      submitController = controller
      void serverSDK.api.integration.oauth
        .complete({ ...attempt, code: effect.code }, { signal: controller.signal })
        .then(
          () => {
            if (!controller.signal.aborted) dispatch({ type: "submit.succeeded", submitAttempt: effect.submitAttempt })
          },
          (error) => {
            if (controller.signal.aborted) return
            dispatch({
              type: "submit.failed",
              submitAttempt: effect.submitAttempt,
              message: formatServerError(error, language.t),
            })
          },
        )

      return
    }

    if (effect.type === "submit.abort") {
      submitController?.abort()
      submitController = undefined

      return
    }

    if (effect.type === "sync") {
      clearTimeout(syncTimer)
      syncTimer = setTimeout(
        () => dispatch({ type: "sync.timed-out", syncAttempt: effect.syncAttempt }),
        effect.timeoutMs,
      )
      void Promise.try(props.onSync).then(
        () => dispatch({ type: "sync.succeeded", syncAttempt: effect.syncAttempt }),
        (error) =>
          dispatch({
            type: "sync.failed",
            syncAttempt: effect.syncAttempt,
            message: formatServerError(error, language.t),
          }),
      )

      return
    }

    if (effect.type === "sync.clear") return clearTimeout(syncTimer)

    if (effect.type === "refresh") return void Promise.try(props.onSync).catch(() => undefined)

    if (effect.type === "open-external") return platform.openExternal(effect.url)

    if (effect.type === "cancel") return void serverSDK.api.integration.oauth.cancel(attempt).catch(() => undefined)

    props.onClose()
  }

  const poll = (pollAttempt: number) => {
    const controller = new AbortController()
    pollController = controller
    void serverSDK.api.integration.oauth.status(attempt, { signal: controller.signal }).then(
      (response) => {
        if (controller.signal.aborted) return
        const status = response.data
        dispatch({
          type: "polled",
          pollAttempt,
          outcome:
            status.status === "failed" ? { status: "failed", message: status.message } : { status: status.status },
        })
      },
      (error) => {
        if (controller.signal.aborted) return
        dispatch({
          type: "polled",
          pollAttempt,
          outcome: { status: "unreachable", message: formatServerError(error, language.t) },
        })
      },
    )
  }

  const abortPoll = () => {
    clearTimeout(pollTimer)
    pollController?.abort()
    pollController = undefined
  }

  const failure = (value: McpSignInFailure) => {
    if (value.type === "auth-expired")
      return language.t("provider.connect.status.failed", { error: language.t("provider.connect.oauth.expired") })

    if (value.type === "auth-failed") return language.t("provider.connect.status.failed", { error: value.message })

    if (value.type === "sync-failed") return value.message

    return language.t("mcp.timedOut", { name: props.name })
  }

  const entryError = () => {
    const error = view().entryError

    if (!error) return

    return error.type === "rejected" ? error.message : language.t("dialog.mcp.signIn.paste.required")
  }

  onMount(() => {
    input?.focus({ preventScroll: true })
    initial.effects.forEach(run)
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <Dialog size="normal">
      <DialogHeader>
        <DialogTitleGroup title={language.t("dialog.mcp.signIn.open", { name: props.name })} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-5 px-3 pb-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          <div>{language.t("dialog.mcp.signIn.description", { name: props.name })}</div>
          <Show
            when={view().failure}
            fallback={
              <div class="flex items-center gap-2">
                <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
                <span>{language.t("provider.connect.status.waiting")}</span>
              </div>
            }
          >
            {(current) => (
              <div role="alert" class="text-v2-state-fg-danger">
                {failure(current())}
              </div>
            )}
          </Show>
          <Show when={view().showOpenBrowser || view().canRetry}>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={view().showOpenBrowser}>
                <Button variant="neutral" icon="arrow-up-right" onClick={() => dispatch({ type: "browser.open" })}>
                  {language.t("provider.connect.oauth.openBrowser")}
                </Button>
              </Show>
              <Show when={view().canRetry}>
                <Button variant="neutral" onClick={() => dispatch({ type: "retry.requested" })}>
                  {language.t("common.retry")}
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={view().showForm}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                dispatch({ type: "paste.submitted" })
              }}
              class="flex flex-col items-start gap-5 self-stretch"
            >
              <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
                {language.t("dialog.mcp.signIn.paste.label")}
                <TextInput
                  ref={input}
                  class="!w-full"
                  name="redirect"
                  placeholder={language.t("dialog.mcp.signIn.paste.placeholder")}
                  value={view().value}
                  readOnly={view().locked}
                  invalid={entryError() !== undefined}
                  aria-describedby={entryError() ? errorID : undefined}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => dispatch({ type: "paste.changed", value: event.currentTarget.value })}
                />
              </label>
              <Show when={entryError()}>
                {(error) => (
                  <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                    {error()}
                  </div>
                )}
              </Show>
              <Button type="submit" variant="contrast" disabled={view().locked} aria-busy={view().submitting}>
                {language.t("common.continue")}
              </Button>
            </form>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
