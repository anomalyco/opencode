import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { createSignal, Show } from "solid-js"
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/drawer"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import introducingTabsVideo from "@/assets/help/introducing-tabs.mp4"
import homeImage from "@/assets/help/home.png"
import tabsImage from "@/assets/help/tabs.png"

// TODO: wire to changelog / seen-state when available
const showPopover = () => true

// can remove this after the tabs rollout has been out for a while
export function TabsInfoPopup() {
  const settings = useSettings()
  const platform = usePlatform()
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const windows = () => platform.platform === "desktop" && platform.os === "windows"

  return (
    <Drawer open={drawerOpen()} onOpenChange={setDrawerOpen} side="right">
      <Show when={settings.general.shouldDisplayTabsToast()}>
        <div
          class="fixed bottom-5 right-5 z-50 h-[240px] w-[192px] rounded-[8px] bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-floating)]"
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
      <DrawerContent
        style={
          windows()
            ? {
                inset: "0 0 0 auto",
                "max-height": "100vh",
                "max-width": "100vw",
                "border-radius": "0",
              }
            : undefined
        }
      >
        <Show when={windows()}>
          <DrawerClose
            as={IconButtonV2}
            type="button"
            size="small"
            variant="neutral"
            aria-label="Close"
            icon={<IconV2 name="xmark-small" />}
            class="absolute top-[10px] left-[-36px]"
          />
        </Show>
        <div
          class="flex w-full shrink-0 items-center gap-4 self-stretch border-b border-v2-border-border-muted"
          classList={{
            "h-[40px] px-4": windows(),
            "h-[52px] p-4": !windows(),
          }}
        >
          <p class="min-h-0 min-w-0 flex-1 text-[13px] font-[530] leading-5 tracking-[-0.04px] tabular-nums text-v2-text-text-muted">
            July 14
          </p>
          <Show when={!windows()}>
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
