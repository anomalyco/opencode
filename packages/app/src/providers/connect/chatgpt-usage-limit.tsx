import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogTitle } from "@opencode/ui/dialog"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { Show, createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

export function DialogChatGPTUsageLimit(props: { workspace?: boolean }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal(false)

  return (
    <Dialog fit containerClass="!rounded-xl">
      <div class="flex w-full flex-col items-center px-8 pb-8 pt-9 text-center [font-family:var(--v2-font-family-sans)]">
        <ProviderIcon id="openai" class="!size-12 text-v2-icon-icon-base" aria-hidden="true" />
        <div class="mt-6 max-w-[270px] text-[20px] font-[530] leading-7 tracking-[-0.3px] text-v2-text-text-base">
          <DialogTitle>
            <bdi dir="auto">{language.t("provider.connect.chatgptUsageLimit.title")}</bdi>
          </DialogTitle>
        </div>
        <p class="mt-3 text-[13px] leading-5 text-v2-text-text-muted">
          <bdi dir="auto">
            {language.t(
              props.workspace
                ? "provider.connect.chatgptUsageLimit.workspaceDescription"
                : "provider.connect.chatgptUsageLimit.description",
            )}
          </bdi>
        </p>
        <Button
          variant="contrast"
          size="large"
          class="mt-8 w-full"
          autofocus
          onClick={() => {
            if (props.workspace) {
              const text = language.t("provider.connect.chatgptUsageLimit.request")
              void Promise.resolve()
                .then(() =>
                  platform.writeClipboardText ? platform.writeClipboardText(text) : navigator.clipboard.writeText(text),
                )
                .then(() => setCopied(true))
                .catch(() => setCopied(false))

              return
            }

            platform.openExternal("https://chatgpt.com/settings/usage")
            dialog.close()
          }}
        >
          {language.t(
            props.workspace
              ? "provider.connect.chatgptUsageLimit.copyRequest"
              : "provider.connect.chatgptUsageLimit.manage",
          )}
        </Button>
        <Show when={copied()}>
          <p role="status" class="mt-3 text-[13px] leading-5 text-v2-text-text-muted">
            <bdi dir="auto">{language.t("provider.connect.chatgptUsageLimit.requestCopied")}</bdi>
          </p>
        </Show>
        <Button variant="ghost" size="large" class="mt-2 w-full" onClick={() => dialog.close()}>
          {language.t("provider.connect.chatgptUsageLimit.close")}
        </Button>
      </div>
    </Dialog>
  )
}
