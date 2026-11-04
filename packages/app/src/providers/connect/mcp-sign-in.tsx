import { createUniqueId, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"

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
  onDone: () => Promise<void>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const errorID = createUniqueId()
  const attempt = { integrationID: props.integrationID, attemptID: props.attemptID, location: props.location }

  const [store, setStore] = createStore<{ value: string; error?: string; failed?: string; submitting: boolean }>({
    value: "",
    submitting: false,
  })

  let input: HTMLInputElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = Date.now() + props.lifetime
  let disposed = false
  let settled = false

  const fail = (message: string) => {
    settled = true
    setStore("failed", message)
  }

  const poll = async () => {
    const result = await serverSDK.api.integration.oauth
      .status(attempt)
      .then((response) => ({ ok: true as const, status: response.data }))
      .catch((error) => ({ ok: false as const, error }))

    if (disposed) return

    // A failed request says nothing about the attempt, which may still be pending, so keep polling until it expires.
    if (!result.ok) {
      if (Date.now() >= deadline) return fail(formatServerError(result.error, language.t))
      timer = setTimeout(() => void poll(), 1_000)

      return
    }

    if (result.status.status === "complete") {
      settled = true

      return props.onDone()
    }

    if (result.status.status === "failed") return fail(result.status.message)

    if (result.status.status === "expired") return fail(language.t("provider.connect.oauth.expired"))
    timer = setTimeout(() => void poll(), 1_000)
  }

  // A rejected paste leaves the attempt waiting; an accepted one settles through the status poll.
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const code = store.value.trim()

    if (!code) return setStore("error", language.t("dialog.mcp.signIn.paste.required"))
    setStore({ error: undefined, submitting: true })

    const error = await serverSDK.api.integration.oauth
      .complete({ ...attempt, code })
      .then(() => undefined)
      .catch((error) => formatServerError(error, language.t))

    setStore({ error, submitting: false })
  }

  onMount(() => {
    input?.focus({ preventScroll: true })
    void poll()
  })
  // Like the TUI, dismissing the dialog ends the attempt, so a late browser callback cannot connect the server.
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)

    if (settled) return
    void serverSDK.api.integration.oauth.cancel(attempt).catch(() => undefined)
  })

  return (
    <Dialog size="normal">
      <DialogHeader>
        <DialogTitleGroup title={language.t("dialog.mcp.signIn.open", { name: props.name })} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-5 px-3 pb-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          <div>{language.t("dialog.mcp.signIn.description", { name: props.name })}</div>
          <Show
            when={store.failed}
            fallback={
              <div class="flex items-center gap-2">
                <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
                <span>{language.t("provider.connect.status.waiting")}</span>
              </div>
            }
          >
            {(failed) => (
              <div role="alert" class="text-v2-state-fg-danger">
                {language.t("provider.connect.status.failed", { error: failed() })}
              </div>
            )}
          </Show>
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="neutral" icon="arrow-up-right" onClick={() => platform.openExternal(props.url)}>
              {language.t("provider.connect.oauth.openBrowser")}
            </Button>
          </div>
          <Show when={!store.failed}>
            <form onSubmit={submit} class="flex flex-col items-start gap-5 self-stretch">
              <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
                {language.t("dialog.mcp.signIn.paste.label")}
                <TextInput
                  ref={input}
                  class="!w-full"
                  name="redirect"
                  placeholder={language.t("dialog.mcp.signIn.paste.placeholder")}
                  value={store.value}
                  invalid={store.error !== undefined}
                  aria-describedby={store.error ? errorID : undefined}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => setStore("value", event.currentTarget.value)}
                />
              </label>
              <Show when={store.error}>
                {(error) => (
                  <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                    {error()}
                  </div>
                )}
              </Show>
              <Button type="submit" variant="contrast" disabled={store.submitting}>
                {language.t("common.continue")}
              </Button>
            </form>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
