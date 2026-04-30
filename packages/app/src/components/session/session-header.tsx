import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useTerminal } from "@/context/terminal"
import { focusTerminalById } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { StatusPopover } from "../status-popover"

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const platform = usePlatform()
  const language = useLanguage()
  const terminal = useTerminal()
  const { view } = useSessionLayout()

  const isDesktopBeta = platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const tree = createMemo(() => !isDesktopBeta)
  const term = createMemo(() => !isDesktopBeta)
  const status = createMemo(() => !isDesktopBeta)

  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return

    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    setRightMount(document.getElementById("opencode-titlebar-right"))
  })

  return (
    <Show when={rightMount()}>
      {(mount) => (
        <Portal mount={mount()}>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1">
              <Show when={status()}>
                <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
                  <StatusPopover />
                </Tooltip>
              </Show>
              <Show when={term()}>
                <TooltipKeybind
                  title={language.t("command.terminal.toggle")}
                  keybind={command.keybind("terminal.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                    onClick={toggleTerminal}
                    aria-label={language.t("command.terminal.toggle")}
                    aria-expanded={view().terminal.opened()}
                    aria-controls="terminal-panel"
                  >
                    <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                  </Button>
                </TooltipKeybind>
              </Show>

              <div class="hidden md:flex items-center gap-1 shrink-0">
                <TooltipKeybind
                  title={language.t("command.review.toggle")}
                  keybind={command.keybind("review.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
                    onClick={() => view().reviewPanel.toggle()}
                    aria-label={language.t("command.review.toggle")}
                    aria-expanded={view().reviewPanel.opened()}
                    aria-controls="review-panel"
                  >
                    <Icon size="small" name={view().reviewPanel.opened() ? "review-active" : "review"} />
                  </Button>
                </TooltipKeybind>

                <Show when={tree()}>
                  <TooltipKeybind
                    title={language.t("command.fileTree.toggle")}
                    keybind={command.keybind("fileTree.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => layout.fileTree.toggle()}
                      aria-label={language.t("command.fileTree.toggle")}
                      aria-expanded={layout.fileTree.opened()}
                      aria-controls="file-tree-panel"
                    >
                      <div class="relative flex items-center justify-center size-4">
                        <Icon
                          size="small"
                          name={layout.fileTree.opened() ? "file-tree-active" : "file-tree"}
                          classList={{
                            "text-icon-strong": layout.fileTree.opened(),
                            "text-icon-weak": !layout.fileTree.opened(),
                          }}
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}
