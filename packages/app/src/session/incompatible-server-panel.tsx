import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { serverName } from "@/runtime/server/registry"

export function IncompatibleServerPanel(props: { onClose?: () => void }) {
  const language = useLanguage()
  const server = useServer()

  return (
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
        <Icon name="warning" size="large" class="text-icon-warning-base" />
        <div class="flex flex-col items-center gap-2">
          <div class="text-16-medium text-text max-w-md">{language.t("session.error.incompatible")}</div>
          <div class="text-13-regular text-text-weak max-w-md">
            {language.t("session.error.incompatible.description", {
              server: serverName(server.conn),
              version: server.health?.version ?? "1",
            })}
          </div>
        </div>
        <Show when={props.onClose}>
          <Button variant="neutral" size="normal" icon="xmark-small" onClick={() => props.onClose?.()}>
            {language.t("session.error.notFound.closeTab")}
          </Button>
        </Show>
      </div>
    </div>
  )
}
