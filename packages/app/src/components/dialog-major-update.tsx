import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, Match, Show, Switch } from "solid-js"
import { ExternalLink } from "@/components/external-link"
import { useLanguage } from "@/context/language"
import type { MajorUpdaterPlatform } from "@/updater"

export const V2_ANNOUNCEMENT_URL = "https://anoma.ly/notes/opencode-2-0"
export const MAJOR_INSTRUCTIONS = "https://opencode.ai/v2/docs"

// The desktop counterpart of the TUI's /update dialog for OpenCode 2.0: same copy, same Dismiss and Upgrade choices.
export function DialogMajorUpdate(props: { major: MajorUpdaterPlatform; dismiss: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const status = () => props.major.state().status
  const failed = () => {
    const state = props.major.state()
    if (state.status === "failed") return state
  }

  // A newer OpenCode 1 release withdraws the offer, so there is nothing left to choose here.
  createEffect(() => {
    if (status() === "unavailable") dialog.close()
  })

  const title = () => {
    if (status() === "installing") return language.t("dialog.update.installing.title")
    if (status() === "installed") return language.t("titlebar.update")
    return language.t("toast.update.title")
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={title()}
          description={
            <span class="flex flex-col gap-3 pt-1" data-component="major-update" data-status={status()}>
              <Switch>
                <Match when={status() === "available"}>
                  <span class="flex flex-col">
                    <span>{language.t("dialog.update.major.description")}</span>
                    <ExternalLink href={V2_ANNOUNCEMENT_URL} class="!text-v2-text-text-accent !no-underline">
                      {language.t("dialog.update.major.readMore", { url: V2_ANNOUNCEMENT_URL })}
                    </ExternalLink>
                  </span>
                  <span>{language.t("dialog.update.major.breaking")}</span>
                </Match>
                <Match when={status() === "installing"}>
                  <span class="flex items-center gap-2">
                    <LoaderV2 />
                    {language.t("dialog.update.major.installing")}
                  </span>
                </Match>
                <Match when={status() === "installed"}>
                  <span>{language.t("dialog.update.major.installed")}</span>
                </Match>
                <Match when={failed()}>
                  {(failed) => (
                    <span class="flex flex-col text-v2-state-fg-danger">
                      <span class="select-text break-words">
                        {failed().message ?? language.t("desktop.updater.dialog.checkFailed.message")}
                      </span>
                      <ExternalLink href={MAJOR_INSTRUCTIONS} class="!text-v2-state-fg-danger !no-underline">
                        {language.t("dialog.update.major.manual", { url: MAJOR_INSTRUCTIONS })}
                      </ExternalLink>
                    </span>
                  )}
                </Match>
              </Switch>
            </span>
          }
        />
      </DialogHeader>
      <Show when={status() !== "installing"}>
        <DialogFooter>
          <ButtonV2
            variant="ghost"
            onClick={() => {
              if (status() !== "installed") props.dismiss()
              dialog.close()
            }}
          >
            {language.t("common.dismiss")}
          </ButtonV2>
          <Show
            when={status() === "installed"}
            fallback={
              <ButtonV2 variant="contrast" autofocus onClick={() => void props.major.install()}>
                {language.t("dialog.update.major.action.upgrade")}
              </ButtonV2>
            }
          >
            <ButtonV2 variant="contrast" autofocus onClick={() => void props.major.restart()}>
              {language.t("desktop.updater.dialog.restart")}
            </ButtonV2>
          </Show>
        </DialogFooter>
      </Show>
    </Dialog>
  )
}
