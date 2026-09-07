import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, Show } from "solid-js"
import { useCurrentRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { useSshServers } from "./context"
import { DialogSsh } from "./dialog"
import { sshName } from "./name"

export function SshBanner() {
  const ssh = useSshServers()
  const route = useCurrentRoute()
  const tabs = useTabs()
  const language = useLanguage()
  const dialog = useDialog()
  const item = createMemo(() => {
    const current = route()
    const key =
      current.type === "session"
        ? current.server
        : current.type === "draft"
          ? tabs.store.find((tab) => tab.type === "draft" && tab.draftID === current.draftID)?.server
          : undefined
    return ssh.data?.servers.find((item) => `ssh:${item.config.id}` === key && item.stage !== "ready")
  })
  return (
    <Show when={item()}>
      {(item) => (
        <div class="ssh-banner" role="status" aria-live="polite">
          <span>
            {language.t("ssh.offline", { host: sshName(item().config) })} {language.t(`ssh.stage.${item().stage}`)}
          </span>
          <Button
            size="small"
            variant="ghost-muted"
            onClick={() => void dialog.push(() => <DialogSsh config={item().config} connect />)}
          >
            {language.t(item().stage === "authentication" ? "ssh.authenticate" : "ssh.retry")}
          </Button>
        </div>
      )}
    </Show>
  )
}
