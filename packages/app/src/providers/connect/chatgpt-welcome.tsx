import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogTitle } from "@opencode/ui/dialog"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"

export function DialogChatGPTPlanWelcome() {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog fit containerClass="!w-[min(calc(100vw_-_32px),390px)] !rounded-xl">
      <div class="flex w-full flex-col items-center px-8 pb-8 pt-9 text-center [font-family:var(--v2-font-family-sans)]">
        <ProviderIcon id="openai" class="!size-12 text-v2-icon-icon-base" aria-hidden="true" />
        <div class="mt-6 max-w-[270px] text-[20px] font-[530] leading-7 tracking-[-0.3px] text-v2-text-text-base">
          <DialogTitle>
            <bdi dir="auto">{language.t("provider.connect.chatgptWelcome.title")}</bdi>
          </DialogTitle>
        </div>
        <p class="mt-3 text-[13px] leading-5 text-v2-text-text-muted">
          <bdi dir="auto">{language.t("provider.connect.chatgptWelcome.description")}</bdi>
        </p>
        <ExternalLink
          href="https://chatgpt.com/#settings/Usage"
          dir="auto"
          class="mt-1 rounded-sm text-[13px] leading-5 text-v2-text-text-muted underline-offset-2 hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
        >
          {language.t("provider.connect.chatgptWelcome.usage")}
        </ExternalLink>
        <Button variant="contrast" size="large" class="mt-8 w-full" autofocus onClick={() => dialog.close()}>
          {language.t("provider.connect.chatgptWelcome.confirm")}
        </Button>
      </div>
    </Dialog>
  )
}
