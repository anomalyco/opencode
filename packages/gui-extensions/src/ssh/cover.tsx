import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Spinner } from "@opencode/ui/spinner"
import { Show } from "solid-js"
import { createKeyed, useExtension } from "../sdk"
import { isSshConnecting, sshName } from "./name"
import type { SshController } from "./state"

/** The visit to a routed tab in which authentication was offered. Shared by the window's covers. */
export type SshOffer = { visit: object | undefined }

export function SshCover(props: { id: string; visit: object; ssh: SshController; offer: SshOffer }) {
  const extension = useExtension()
  const dialog = useDialog()
  const item = () => props.ssh.item(props.id)

  // Offer authentication once per visit to a tab. Cancelling must not immediately reopen the prompt, and a sign-in
  // requested again after the server was ready (a new cover) shows the Authenticate button without a dialog.
  // Background hosts never open a dialog here. A new object for each change, so every change is considered.
  createKeyed(
    () => {
      const current = item()

      if (current?.stage !== "authentication" || current.authenticatingElsewhere || dialog.active) return

      return { config: current.config, visit: props.visit }
    },
    (offer) => {
      if (props.offer.visit === offer.visit) return
      props.offer.visit = offer.visit
      props.ssh.connect(offer.config)
    },
  )

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
