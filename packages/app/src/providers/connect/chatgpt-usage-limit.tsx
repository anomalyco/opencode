import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogTitle } from "@opencode/ui/dialog"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { writeClipboard } from "@opencode/session-ui/copy"
import { Show, createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

export function DialogChatGPTUsageLimit(props: { workspace?: boolean }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const [copied, setCopied] = createSignal<boolean>()
  const request = () => language.t("provider.connect.chatgptUsageLimit.request")

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
              // writeClipboard falls back to a selected textarea where the async clipboard API is missing (plain HTTP).
              void (
                platform.writeClipboardText
                  ? platform.writeClipboardText(request()).then(() => true)
                  : writeClipboard(request())
              )
                .catch(() => false)
                .then(setCopied)

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
        <Show when={copied() === true}>
          <p role="status" class="mt-3 text-[13px] leading-5 text-v2-text-text-muted">
            <bdi dir="auto">{language.t("provider.connect.chatgptUsageLimit.requestCopied")}</bdi>
          </p>
        </Show>
        <Show when={copied() === false}>
          <p role="status" class="mt-3 text-[13px] leading-5 text-v2-text-text-muted">
            <bdi dir="auto">{language.t("provider.connect.chatgptUsageLimit.requestCopyFailed")}</bdi>
          </p>
          <p class="mt-2 w-full select-text whitespace-pre-wrap rounded-md bg-v2-overlay-simple-overlay-hover p-3 text-left text-[13px] leading-5 text-v2-text-text-base">
            <bdi dir="auto">{request()}</bdi>
          </p>
        </Show>
        <Button variant="ghost" size="large" class="mt-2 w-full" onClick={() => dialog.close()}>
          {language.t("provider.connect.chatgptUsageLimit.close")}
        </Button>
      </div>
    </Dialog>
  )
}
