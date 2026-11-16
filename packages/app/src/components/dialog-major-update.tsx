import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, For, onMount, Show } from "solid-js"
import announcementImage from "@/assets/upgrade/opencode-2-0.png"
import { ExternalLink } from "@/components/external-link"
import { useLanguage } from "@/context/language"
import type { MajorUpdaterPlatform } from "@/updater"
import { showToast } from "@/utils/toast"

export const V2_ANNOUNCEMENT_URL = "https://anoma.ly/notes/opencode-2-0"
export const MAJOR_INSTRUCTIONS = "https://opencode.ai/v2/docs"

// The card image ships with the app and is decoded before the dialog opens. The dialog shows this same element, so
// nothing loads again and the card never paints without its image.
export function preloadMajorUpdateImage() {
  const image = new Image()
  image.alt = ""
  image.className = "size-full object-contain"
  image.src = announcementImage
  return image.decode().then(
    () => image,
    () => image,
  )
}

// The desktop offer for OpenCode 2.0. OpenCode 2 is already downloaded when this opens, so the choices are when to
// install it: now, when the app quits, or later.
export function DialogMajorUpdate(props: { major: MajorUpdaterPlatform; image?: HTMLImageElement; later: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const status = () => props.major.state().status

  // Solid builds this dialog from a template in another document. An image that moves between documents loads again,
  // so the decoded image joins the card only once the card is in the page.
  let media: HTMLDivElement | undefined
  onMount(() => {
    if (props.image) media?.append(props.image)
  })

  // A newer OpenCode 1 release withdraws the offer, so there is nothing left to choose here.
  createEffect(() => {
    if (status() !== "ready" && status() !== "scheduled") dialog.close()
  })

  const failed = () =>
    showToast({
      title: language.t("dialog.update.major.failed"),
      description: language.t("dialog.update.major.manual", { url: MAJOR_INSTRUCTIONS }),
    })
  const restart = () => void props.major.restart().catch(failed)
  const schedule = () =>
    void props.major.schedule().then(() => {
      dialog.close()
      showToast({ variant: "success", icon: "circle-check", title: language.t("dialog.update.major.scheduled") })
    }, failed)

  return (
    <Show
      when={status() !== "scheduled"}
      fallback={
        <Dialog fit>
          <DialogHeader>
            <DialogTitleGroup
              title={language.t("titlebar.update")}
              description={
                <span class="pt-1" data-component="major-update" data-status="scheduled">
                  {language.t("dialog.update.major.scheduled")}
                </span>
              }
            />
          </DialogHeader>
          <DialogFooter>
            <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.close")}
            </ButtonV2>
            <ButtonV2 variant="contrast" autofocus onClick={restart}>
              {language.t("dialog.update.major.action.restartNow")}
            </ButtonV2>
          </DialogFooter>
        </Dialog>
      }
    >
      <Dialog fit containerClass="!w-[min(calc(100vw-32px),720px)]">
        <div class="flex w-full">
          <div class="flex min-w-0 flex-1 flex-col">
            <DialogHeader hideClose>
              <DialogTitleGroup
                title={language.t("dialog.update.major.title")}
                description={
                  <span class="flex flex-col gap-3 pt-1" data-component="major-update" data-status="ready">
                    <span>{language.t("dialog.update.major.lead")}</span>
                    <span class="flex flex-col gap-1.5">
                      <For
                        each={[
                          { ok: true, text: language.t("dialog.update.major.keeps.data") },
                          { ok: true, text: language.t("dialog.update.major.keeps.config") },
                          { ok: false, text: language.t("dialog.update.major.plugins") },
                        ]}
                      >
                        {(item) => (
                          <span class="flex items-center gap-2 text-v2-text-text-base">
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 14 14"
                              fill="none"
                              aria-hidden="true"
                              class={item.ok ? "text-v2-state-fg-success" : "text-v2-state-fg-warning"}
                            >
                              <path
                                d={item.ok ? "M3 7.4L5.8 10L11 4" : "M7 3.5V8M7 10.2V10.4"}
                                stroke="currentColor"
                                stroke-width="1.4"
                              />
                            </svg>
                            {item.text}
                          </span>
                        )}
                      </For>
                    </span>
                    <ExternalLink href={V2_ANNOUNCEMENT_URL} class="!text-v2-text-text-accent !no-underline">
                      {language.t("common.learnMore")}
                    </ExternalLink>
                  </span>
                }
              />
            </DialogHeader>
            <div class="flex-1" />
            <DialogFooter>
              <ButtonV2
                variant="ghost"
                onClick={() => {
                  props.later()
                  dialog.close()
                }}
              >
                {language.t("desktop.updater.dialog.later")}
              </ButtonV2>
              <ButtonV2 variant="neutral" onClick={schedule}>
                {language.t("dialog.update.major.action.quit")}
              </ButtonV2>
              <ButtonV2 variant="contrast" autofocus onClick={restart}>
                {language.t("dialog.update.major.action.restart")}
              </ButtonV2>
            </DialogFooter>
          </div>
          <div class="w-[280px] shrink-0 self-stretch bg-[#080807]" ref={media} />
        </div>
      </Dialog>
    </Show>
  )
}
