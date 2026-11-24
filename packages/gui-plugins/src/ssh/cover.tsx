import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Show } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { sshName } from "./name"
import type { SshController } from "./state"

export function SshCover(props: { id: string; ssh: SshController }) {
  const plugin = usePlugin()
  const item = () => props.ssh.item(props.id)

  // Offer authentication once per server and visit to a tab. Cancelling must not immediately reopen the prompt, and a
  // sign-in requested again after the server was ready (a new cover) shows the Authenticate button without a dialog.
  // Background hosts never open a dialog here.
  createKeyed(
    () => props.ssh.cover.canOffer(props.id, plugin.dialogs.active()),
    () => props.ssh.cover.offer(props.id, plugin.dialogs.active()),
  )

  return (
    <Show when={item()}>
      {(item) => {
        const connecting = () => props.ssh.pending(props.id)

        return (
          <section
            data-component="ssh-connection-panel"
            class="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-v2-background-bg-base px-6 py-8 text-center"
          >
            <Icon name="lock" size="large" class="text-v2-icon-icon-muted" />
            <div class="flex max-w-sm flex-col items-center gap-2" role="status" aria-live="polite">
              <h2 class="text-16-medium text-v2-text-text-base">{plugin.t("session.disconnected")}</h2>
              <bdi dir="auto" class="max-w-full break-all text-13-regular text-v2-text-text-muted">
                {sshName(item().config)}
              </bdi>
              <p class="text-13-regular text-v2-text-text-muted">{plugin.t("session.reconnectDescription")}</p>
            </div>
            <Show when={item().error}>
              {(error) => (
                <p role="alert" class="max-w-sm text-13-regular text-v2-text-text-muted">
                  {plugin.t(`error.${error()}`)}
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
                <Loader class="size-3.5" />
              </Show>
              {connecting()
                ? plugin.t("session.connecting")
                : item().stage === "authentication"
                  ? plugin.t("action.authenticate")
                  : plugin.t("session.reconnect")}
            </Button>
          </section>
        )
      }}
    </Show>
  )
}
