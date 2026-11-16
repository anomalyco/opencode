import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createEffect, createMemo, For, onMount, Show } from "solid-js"
import announcementImage from "@/assets/upgrade/opencode-2-0.png"
import { ExternalLink } from "@/components/external-link"
import { useLanguage } from "@/context/language"
import type { MajorUpdaterPlatform } from "@/updater"
import { showToast } from "@/utils/toast"

export const V2_ANNOUNCEMENT_URL = "https://anoma.ly/notes/opencode-2-0"
export const MAJOR_INSTRUCTIONS = "https://opencode.ai/v2/docs"

const ROW: Record<string, { class: string; path: string }> = {
  new: { class: "text-v2-text-text-accent", path: "M7 3V11M3 7H11" },
  kept: { class: "text-v2-state-fg-success", path: "M3 7.4L5.8 10L11 4" },
  breaks: { class: "text-v2-state-fg-warning", path: "M7 3V7.8M7 9.6V11" },
}

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
export function DialogMajorUpdate(props: {
  major: MajorUpdaterPlatform
  image?: HTMLImageElement
  later: () => void
  // Reports a restart or an upgrade on quit that failed. The card can be closed by then, so it does not show the toast.
  failed: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const status = () => props.major.state().status
  // The install is starting or being armed. Nothing can be chosen until that ends.
  const busy = () => status() === "installing" || status() === "scheduling"
  // While busy, the card keeps the layout the user chose from.
  const scheduled = createMemo<boolean>((previous) => (busy() ? previous : status() === "scheduled"), false)
  const quit = createMemo<boolean>((previous) => {
    const state = props.major.state()
    return state.status === "ready" ? state.quit : previous
  }, true)

  // Solid builds this dialog from a template in another document. An image that moves between documents loads again,
  // so the decoded image joins the card only once the card is in the page.
  let media: HTMLDivElement | undefined
  onMount(() => {
    if (props.image) media?.append(props.image)
  })

  // A newer OpenCode 1 release withdraws the offer, so there is nothing left to choose here.
  createEffect(() => {
    if (status() === "unavailable" || status() === "downloading") dialog.close()
  })

  const restart = () => void props.major.restart().catch(props.failed)
  const schedule = () =>
    void props.major.schedule().then(() => {
      dialog.close()
      showToast({ variant: "success", icon: "circle-check", title: language.t("dialog.update.major.scheduled") })
    }, props.failed)

  // The card can open by itself while the user types, and after a check that took minutes. Focus therefore never
  // starts on a button that installs: a key press meant for something else must not restart the app.
  return (
    <Show
      when={!scheduled()}
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
            <ButtonV2 variant="ghost" autofocus onClick={() => dialog.close()}>
              {language.t("common.close")}
            </ButtonV2>
            <ButtonV2 variant="contrast" disabled={busy()} onClick={restart}>
              {language.t(
                status() === "installing"
                  ? "settings.updates.action.installing"
                  : "dialog.update.major.action.restartNow",
              )}
            </ButtonV2>
          </DialogFooter>
        </Dialog>
      }
    >
      <Dialog fit containerClass="!w-[min(calc(100vw-32px),720px)]">
        <div class="flex w-full outline-none" tabindex="-1" autofocus>
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
                          { kind: "new", text: language.t("dialog.update.major.new.browser") },
                          { kind: "new", text: language.t("dialog.update.major.new.background") },
                          { kind: "new", text: language.t("dialog.update.major.new.plugins") },
                          { kind: "new", text: language.t("dialog.update.major.new.sessions") },
                          { kind: "new", text: language.t("dialog.update.major.new.pair") },
                          { kind: "kept", text: language.t("dialog.update.major.keeps.data") },
                          { kind: "breaks", text: language.t("dialog.update.major.plugins") },
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
                              class={ROW[item.kind].class}
                            >
                              <path d={ROW[item.kind].path} stroke="currentColor" stroke-width="1.4" />
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
              {/* Translated labels can be longer than the row, so the buttons wrap instead of shrinking. */}
              <div class="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
                <ButtonV2
                  variant="ghost"
                  class="shrink-0 whitespace-nowrap"
                  disabled={busy()}
                  onClick={() => {
                    props.later()
                    dialog.close()
                  }}
                >
                  {language.t("desktop.updater.dialog.later")}
                </ButtonV2>
                <Show when={quit()}>
                  <ButtonV2 variant="neutral" class="shrink-0 whitespace-nowrap" disabled={busy()} onClick={schedule}>
                    <Show when={status() === "scheduling"}>
                      <Spinner class="size-3.5 shrink-0" />
                    </Show>
                    {language.t("dialog.update.major.action.quit")}
                  </ButtonV2>
                </Show>
                <ButtonV2 variant="contrast" class="shrink-0 whitespace-nowrap" disabled={busy()} onClick={restart}>
                  {language.t(
                    status() === "installing"
                      ? "settings.updates.action.installing"
                      : "dialog.update.major.action.restart",
                  )}
                </ButtonV2>
              </div>
            </DialogFooter>
          </div>
          {/* A narrow window has no room for the image beside the text. */}
          <div class="w-[280px] shrink-0 self-stretch bg-[#080807] max-md:hidden" ref={media} />
        </div>
      </Dialog>
    </Show>
  )
}
