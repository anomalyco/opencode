import { Popover } from "@kobalte/core/popover"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Show } from "solid-js"
import { useLanguage } from "@/context/language"

export function SessionSharePopover(props: {
  open: boolean
  anchor: () => HTMLElement | undefined
  url?: string
  publishing?: boolean
  unpublishing?: boolean
  onOpenChange: (open: boolean) => void
  onPublish: () => void
  onUnpublish: () => void
  onCopy: () => void
  onView: () => void
}) {
  const language = useLanguage()
  return (
    <Popover open={props.open} anchorRef={props.anchor} placement="bottom-end" gutter={6} modal={false} onOpenChange={props.onOpenChange}>
      <Popover.Portal>
        <Popover.Content class="flex w-80 max-w-none flex-col items-start gap-3 rounded-[10px] border-0 bg-v2-background-bg-layer-01 p-3 shadow-[var(--v2-elevation-floating)]">
          <div class="flex w-full flex-col gap-1.5 px-0.5 pt-0.5">
            <div class="select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
              {language.t("session.share.popover.title")}
            </div>
            <div class="select-none text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-variation-settings:'slnt'_0]">
              {props.url
                ? language.t("session.share.popover.description.shared")
                : language.t("session.share.popover.description.unshared")}
            </div>
          </div>
          <div class="flex w-full flex-col gap-2">
            <Show
              when={props.url}
              fallback={
                <ButtonV2 variant="contrast" class="w-full" onClick={props.onPublish} disabled={props.publishing}>
                  {props.publishing ? language.t("session.share.action.publishing") : language.t("session.share.action.publish")}
                </ButtonV2>
              }
            >
              <div class="flex flex-col gap-2">
                <div
                  class="flex h-8 w-full items-center gap-1.5 rounded-[6px] py-1 pl-2.5 pr-1.5 shadow-[var(--v2-elevation-button-neutral)]"
                  style={{ background: "linear-gradient(180deg, var(--v2-alpha-light-2) 0%, var(--v2-alpha-light-0) 100%), var(--v2-background-bg-button-neutral)" }}
                >
                  <div class="min-w-0 flex-1 truncate select-text cursor-text text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-variation-settings:'slnt'_0]">
                    {props.url}
                  </div>
                  <IconButtonV2 type="button" size="small" variant="ghost-muted" icon={<IconV2 name="outline-copy" />} aria-label={language.t("session.share.copy.copyLink")} onClick={props.onCopy} />
                  <IconButtonV2 type="button" size="small" variant="ghost-muted" icon={<IconV2 name="outline-square-arrow" />} aria-label={language.t("session.share.action.view")} onClick={props.onView} disabled={props.unpublishing} />
                </div>
                <ButtonV2 variant="outline" class="w-full" onClick={props.onUnpublish} disabled={props.unpublishing}>
                  {props.unpublishing ? language.t("session.share.action.unpublishing") : language.t("session.share.action.unpublish")}
                </ButtonV2>
              </div>
            </Show>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
