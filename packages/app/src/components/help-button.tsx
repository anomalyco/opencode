import { Popover } from "@opencode-ai/ui/popover"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { usePlatform } from "@/context/platform"
import introducingTabsVideo from "@/assets/help/introducing-tabs.mp4"

const HELP_ITEMS = [
  { label: "Docs", href: "https://opencode.ai/docs" },
  { label: "Contact us...", href: "https://opencode.ai/desktop-feedback" },
  { label: "Discord community", href: "https://discord.com/invite/opencode" },
] as const

const NEWS_ITEMS = [
  { label: "Tabs Navigation" },
  { label: "Colors & Shadows", disabled: true },
  { label: "Try MiniMax M3", disabled: true },
] as const

const helpIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    data-slot="icon-svg"
  >
    <path
      d="M6.94235 10.5714V10.4854C6.94617 9.76302 7.01879 9.18777 7.16022 8.75968C7.30546 8.33158 7.50804 7.98567 7.76796 7.72193C8.02787 7.45819 8.34321 7.21548 8.71397 6.99379C8.93948 6.85619 9.14206 6.69374 9.32171 6.50645C9.50518 6.31916 9.64851 6.10511 9.75171 5.86431C9.85874 5.62351 9.91225 5.35404 9.91225 5.0559C9.91225 4.69661 9.82625 4.38509 9.65424 4.12136C9.48607 3.85762 9.26055 3.65504 8.9777 3.51362C8.69486 3.36837 8.38143 3.29575 8.03743 3.29575C7.73165 3.29575 7.43733 3.35882 7.15448 3.48495C6.87546 3.61108 6.6423 3.80984 6.45501 4.08122C6.26772 4.3526 6.15878 4.70425 6.12821 5.13617H4.56299C4.59357 4.47109 4.76557 3.9054 5.07899 3.43908C5.39242 2.96894 5.80522 2.61156 6.31741 2.36694C6.83341 2.12231 7.40675 2 8.03743 2C8.72161 2 9.31789 2.13378 9.82625 2.40134C10.3384 2.66507 10.734 3.0301 11.0131 3.49642C11.2959 3.96273 11.4373 4.49976 11.4373 5.1075C11.4373 5.53177 11.3724 5.914 11.2424 6.25418C11.1124 6.59436 10.9251 6.89823 10.6805 7.16579C10.4397 7.43335 10.1492 7.67033 9.80905 7.87673C9.48033 8.08313 9.21468 8.301 9.0121 8.53034C8.80952 8.75585 8.66237 9.02341 8.57063 9.33302C8.4789 9.64262 8.42921 10.0268 8.42156 10.4854V10.5714H6.94235ZM7.72782 14C7.43351 14 7.17933 13.8949 6.96528 13.6847C6.75506 13.4744 6.64994 13.2203 6.64994 12.9221C6.64994 12.6278 6.75506 12.3755 6.96528 12.1653C7.17933 11.9551 7.43351 11.85 7.72782 11.85C8.02214 11.85 8.27441 11.9551 8.48463 12.1653C8.69868 12.3755 8.8057 12.6278 8.8057 12.9221C8.8057 13.1209 8.75601 13.3024 8.65663 13.4668C8.55726 13.6273 8.4273 13.7573 8.26676 13.8567C8.10623 13.9522 7.92658 14 7.72782 14Z"
      fill="var(--v2-icon-icon-base)"
    />
  </svg>
)

const triggerClass =
  "size-7 !rounded-full shrink-0 [background-image:linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_100%),linear-gradient(0deg,#FFFFFF,#FFFFFF)]"

const triggerProps = {
  type: "button" as const,
  "aria-label": "Help",
  size: "large" as const,
  variant: "neutral" as const,
  class: triggerClass,
  icon: helpIcon,
}

// TODO: wire to changelog / seen-state when available
const showPopover = () => true

export function HelpButton() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  const platform = usePlatform()
  const [open, setOpen] = createSignal(showPopover())

  return (
    <div class="fixed bottom-9 right-5 z-50">
      <Switch>
        <Match when={showPopover()}>
          <Popover
            open={open()}
            onOpenChange={setOpen}
            triggerAs={IconButtonV2}
            triggerProps={triggerProps}
            class="[&_[data-slot=popover-body]]:p-0 w-[192px] min-w-[192px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-[8px]"
            gutter={8}
            placement="top-end"
          >
            <Show when={open()}>
              <div
                class="relative w-[192px] h-[240px] rounded-[8px] bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-floating)]"
                aria-label="Introducing Tabs. A faster, more intuitive way to work."
              >
                <button
                  type="button"
                  aria-label="Close"
                  class="absolute top-3 right-3 z-10 size-5 flex items-center justify-center rounded-[4px] bg-[rgba(0,0,0,0.4)]"
                  onClick={() => setOpen(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="white" />
                  </svg>
                </button>
                <div class="relative h-[232px] w-[184px] overflow-hidden rounded-[4px]">
                  <video
                    src={introducingTabsVideo}
                    class="absolute inset-0 h-full w-full object-cover"
                    loop
                    muted
                    autoplay
                    playsinline
                    aria-hidden="true"
                    onContextMenu={(event) => event.preventDefault()}
                  />
                  <div class="absolute inset-x-0 bottom-0 flex w-full flex-col items-start gap-1.5 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,#000000_100%)] px-3 py-5">
                    <p class="w-full cursor-default select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-[#FFFFFF]">Introducing Tabs</p>
                    <p class="w-full cursor-default select-none text-[13px] font-[440] leading-[140%] tracking-[-0.04px] text-[#808080]">
                      A faster, more intuitive way to work.
                    </p>
                  </div>
                </div>
              </div>
            </Show>
          </Popover>
        </Match>
        <Match when={!showPopover()}>
          <MenuV2 open={open()} onOpenChange={setOpen} gutter={8} modal={false} placement="top-end">
            <MenuV2.Trigger as={IconButtonV2} {...triggerProps} />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Group>
                  <MenuV2.GroupLabel>Help</MenuV2.GroupLabel>
                  <For each={HELP_ITEMS}>
                    {(item) => (
                      <MenuV2.Item onSelect={() => platform.openLink(item.href)}>{item.label}</MenuV2.Item>
                    )}
                  </For>
                </MenuV2.Group>
                <MenuV2.Separator />
                <MenuV2.Group>
                  <MenuV2.GroupLabel>News</MenuV2.GroupLabel>
                  <For each={NEWS_ITEMS}>
                    {(item) => <MenuV2.Item disabled={"disabled" in item && item.disabled}>{item.label}</MenuV2.Item>}
                  </For>
                </MenuV2.Group>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </Match>
      </Switch>
    </div>
  )
}
