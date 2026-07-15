import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { createSignal, Show } from "solid-js"
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import introducingTabsVideo from "@/assets/help/introducing-tabs.mp4"
import homeImage from "@/assets/help/home.png"
import tabsImage from "@/assets/help/tabs.png"

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
  "size-7 !rounded-full shrink-0 bg-v2-background-bg-base shadow-[var(--v2-elevation-button-neutral)]"

// TODO: wire to changelog / seen-state when available
const showPopover = () => true

export function HelpButton() {
  const platform = usePlatform()

  return (
    <a
      href="https://opencode.ai"
      aria-label="Open the OpenCode website"
      data-component="icon-button-v2"
      data-size="large"
      class={`${triggerClass} fixed bottom-5 right-5 z-50 flex items-center justify-center`}
      onClick={(event) => {
        event.preventDefault()
        platform.openLink(event.currentTarget.href)
      }}
    >
      {helpIcon}
    </a>
  )
}

// can remove this after the tabs rollout has been out for a while
export function TabsInfoPopup() {
  const settings = useSettings()
  const platform = usePlatform()
  const [drawerOpen, setDrawerOpen] = createSignal(false)

  return (
    <Drawer open={drawerOpen()} onOpenChange={setDrawerOpen} side="right">
      <Show when={settings.general.shouldDisplayTabsToast()}>
        <div
          class="fixed bottom-14 right-5 z-50 h-[240px] w-[192px] rounded-[8px] bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-floating)]"
          aria-label="Introducing Tabs. Organize your work and active sessions with tabs"
        >
          <button
            type="button"
            aria-label="Dismiss Tabs information"
            class="absolute top-3 right-3 z-10 size-5 flex items-center justify-center rounded-[4px] bg-[rgba(0,0,0,0.4)]"
            onClick={settings.general.dismissTabsToast}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="white" />
            </svg>
          </button>
          <button
            type="button"
            class="relative block h-[232px] w-[184px] cursor-pointer overflow-hidden rounded-[4px] text-left"
            onClick={() => {
              settings.general.dismissTabsToast()
              setDrawerOpen(true)
            }}
          >
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
              <p class="w-full select-none text-[13px] font-[530] leading-none tracking-[-0.04px] text-[#FFFFFF]">
                Introducing Tabs
              </p>
              <p class="w-full select-none text-[13px] font-[440] leading-[140%] tracking-[-0.04px] text-[#808080]">
                Organize your work and active sessions with tabs
              </p>
            </div>
          </button>
        </div>
      </Show>
      <DrawerContent>
        <div class="flex h-[52px] w-full shrink-0 items-center gap-4 self-stretch border-b border-v2-border-border-muted p-4">
          <p class="min-h-0 min-w-0 flex-1 text-[13px] font-[530] leading-5 tracking-[-0.04px] tabular-nums text-v2-text-text-muted">
            July 14
          </p>
          <Show when={platform.platform !== "desktop" || platform.os !== "windows"}>
            <DrawerClose
              as={IconButtonV2}
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label="Close"
              icon={<IconV2 name="xmark-small" />}
            />
          </Show>
        </div>
        <div class="relative flex min-h-0 w-full flex-1 flex-col items-start gap-6 overflow-y-auto p-8">
          <p class="w-full shrink-0 self-stretch text-[21px] font-[610] leading-6 tracking-[-0.37px] tabular-nums text-v2-text-text-base">
            Introducing Tabs
          </p>
          <div class="flex w-full flex-1 flex-col gap-4 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base">
            <p>OpenCode Desktop is now built around tabs.</p>
            <img src={tabsImage} alt="" class="aspect-video w-full rounded-[6px] object-cover" />
            <p>
              Start a new session in a tab, or open an existing session from any of your projects. Open a new tab when
              you're starting something new, and close it when you're done.
            </p>
            <p>
              Keeping a few tabs open makes it easier to organize your active sessions. Rename tabs to something
              memorable if you plan to keep them around.
            </p>
            <p>
              You'll find all your sessions and projects on the new Home screen. Selecting a session opens it in a tab.
            </p>
            <img src={homeImage} alt="" class="aspect-video w-full rounded-[6px] object-cover" />
            <p>When you reopen the app, your tabs are still open.</p>
            <p>
              The new design does not support Git Worktrees yet, it's coming soon. So if you'd prefer to continue using
              the previous layout, you can switch between layouts in Settings. Just keep in mind that the new layout
              will become permanent in a few weeks.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
