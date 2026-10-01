import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Spinner } from "@opencode/ui/spinner"
import { createEffect, onCleanup, Show } from "solid-js"
import { useExtension } from "../sdk"
import { isSshConnecting, sshName } from "./name"
import type { SshController } from "./state"

/** Which routed tab was already offered authentication. Shared by every cover of the window. */
export type SshOffer = { selection: string | undefined; offered: boolean }

export function SshCover(props: { id: string; tab: () => string; ssh: SshController; offer: SshOffer }) {
  const extension = useExtension()
  const dialog = useDialog()
  const item = () => props.ssh.item(props.id)
  // Offer authentication once per selected tab. Cancelling must not immediately
  // reopen the prompt; background hosts never open a dialog here.
  createEffect(() => {
    const selection = props.tab()
    if (props.offer.selection !== selection) {
      props.offer.selection = selection
      props.offer.offered = false
    }
    const current = item()
    if (props.offer.offered || current?.stage !== "authentication" || current.authenticatingElsewhere || dialog.active)
      return
    props.offer.offered = true
    props.ssh.connect(current.config)
  })
  // A tab routed again after the cover was gone counts as a new selection.
  onCleanup(() => {
    props.offer.selection = undefined
  })
  return (
    <Show when={item()}>
      {(item) => {
        const connecting = () => props.ssh.pending(props.id) || isSshConnecting(item().stage)
        return (
          <section
            data-component="ssh-connection-panel"
            class="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-v2-background-bg-base px-6 py-8 text-center"
          >
            <Icon name="lock" size="large" class="text-v2-icon-icon-muted" />
            <div class="flex max-w-sm flex-col items-center gap-2" role="status" aria-live="polite">
              <h2 class="text-16-medium text-v2-text-text-base">{extension.t("session.disconnected")}</h2>
              <bdi dir="auto" class="max-w-full break-all text-13-regular text-v2-text-text-muted">
                {sshName(item().config)}
              </bdi>
              <p class="text-13-regular text-v2-text-text-muted">{extension.t("session.reconnectDescription")}</p>
            </div>
            <Show when={item().error}>
              {(error) => (
                <p role="alert" class="max-w-sm text-13-regular text-v2-text-text-muted">
                  {extension.t(`error.${error()}`)}
                </p>
              )}
            </Show>
            <Button
              variant="neutral"
              disabled={connecting()}
              aria-busy={connecting()}
              onClick={() => props.ssh.connect(item().config)}
            >
              <Show when={connecting()}>
                <Spinner class="size-3.5" />
              </Show>
              {connecting()
                ? extension.t("session.connecting")
                : item().stage === "authentication"
                  ? extension.t("action.authenticate")
                  : extension.t("session.reconnect")}
            </Button>
          </section>
        )
      }}
    </Show>
  )
}
