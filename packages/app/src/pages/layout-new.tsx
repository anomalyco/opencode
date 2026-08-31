import { createEffect, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"

function RailButton(
  props: ParentProps<{
    label: string
    keybind?: string[]
    active?: boolean
    onClick: () => void
  }>,
) {
  return (
    <TooltipV2
      placement="right"
      value={
        <>
          {props.label}
          <Show when={props.keybind?.length}>
            <KeybindV2 keys={props.keybind ?? []} variant="neutral" />
          </Show>
        </>
      }
    >
      <IconButtonV2
        type="button"
        variant="ghost-muted"
        size="large"
        class="!size-8"
        state={props.active ? "pressed" : undefined}
        onClick={props.onClick}
        aria-label={props.label}
        aria-pressed={props.active}
        icon={props.children}
      />
    </TooltipV2>
  )
}

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-black flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        showHomeButton={false}
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <aside
          aria-label={language.t("sidebar.nav.projectsAndSessions")}
          class="hidden md:flex w-12 shrink-0 flex-col items-center border-e border-v2-border-border-base bg-black px-2 py-2"
          style={{
            "--icon-strong-base": "#fff",
            "--icon-weak-base": "#666",
            "--v2-icon-icon-base": "#fff",
            "--v2-icon-icon-muted": "#858585",
          }}
        >
          <Mark class="mb-3 h-5 w-4 shrink-0" />
          <div class="flex flex-col items-center gap-1">
            <RailButton
              label={language.t("home.title")}
              keybind={command.keybindParts("home.toggle")}
              active={layout.route().type === "home"}
              onClick={() => command.trigger("home.toggle")}
            >
              <Icon name="grid-plus" />
            </RailButton>
            <RailButton
              label={language.t("command.session.new")}
              keybind={command.keybindParts("tab.new")}
              active={layout.route().type === "draft"}
              onClick={() => command.trigger("tab.new")}
            >
              <Icon name="plus" />
            </RailButton>
            <RailButton
              label={language.t("command.palette")}
              keybind={command.keybindParts("command.palette")}
              onClick={command.show}
            >
              <Icon name="magnifying-glass" />
            </RailButton>
          </div>
          <div class="mt-auto flex flex-col items-center gap-1">
            <RailButton
              label={language.t("sidebar.settings")}
              keybind={command.keybindParts("settings.open")}
              onClick={() => command.trigger("settings.open")}
            >
              <Icon name="settings-gear" />
            </RailButton>
            <RailButton
              label={language.t("sidebar.help")}
              onClick={() => platform.openExternal("https://opencode.ai/desktop-feedback")}
            >
              <Icon name="help" />
            </RailButton>
          </div>
        </aside>
        <div class="flex-1 min-h-0 min-w-0 flex bg-v2-background-bg-deep">
          <main class="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col items-start contain-strict">
            <Suspense>{props.children}</Suspense>
          </main>
        </div>
        <aside
          aria-label={language.t("command.category.view")}
          class="hidden md:flex w-12 shrink-0 border-s border-v2-border-border-base bg-black"
          style={{
            "--v2-icon-icon-base": "#fff",
            "--v2-icon-icon-muted": "#858585",
          }}
        >
          <div id="opencode-shell-rail-right" class="size-full" />
        </aside>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
