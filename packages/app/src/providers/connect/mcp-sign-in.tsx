import { Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { createMcpSignIn, type McpSignInFailure } from "@opencode/ui/mcp-sign-in"
import { RedirectPasteForm } from "@opencode/ui/redirect-paste"
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
  /** Reloads the MCP server and resource lists once the sign-in succeeded. */
  onSync: () => Promise<void>
  onClose: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const attempt = { integrationID: props.integrationID, attemptID: props.attemptID, location: props.location }

  const signIn = createMcpSignIn({
    url: props.url,
    lifetime: props.lifetime,
    status: (signal) => serverSDK.api.integration.oauth.status(attempt, { signal }).then((response) => response.data),
    complete: (code, signal) => serverSDK.api.integration.oauth.complete({ ...attempt, code }, { signal }),
    cancel: () => serverSDK.api.integration.oauth.cancel(attempt),
    sync: props.onSync,
    openExternal: (url) => platform.openExternal(url),
    close: props.onClose,
    message: (error) => formatServerError(error, language.t),
  })

  const view = signIn.view
  const dispatch = signIn.dispatch

  const failure = (value: McpSignInFailure) => {
    if (value.type === "auth-expired")
      return language.t("provider.connect.status.failed", { error: language.t("provider.connect.oauth.expired") })

    if (value.type === "auth-failed") return language.t("provider.connect.status.failed", { error: value.message })

    if (value.type === "sync-failed")
      return language.t("dialog.mcp.signIn.syncFailed", { name: props.name, error: value.message })

    return language.t("mcp.timedOut", { name: props.name })
  }

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
            <RedirectPasteForm
              value={view().value}
              error={view().entryError}
              locked={view().locked}
              submitting={view().submitting}
              autofocus
              onInput={(value) => dispatch({ type: "paste.changed", value })}
              onSubmit={() => dispatch({ type: "paste.submitted" })}
            />
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
