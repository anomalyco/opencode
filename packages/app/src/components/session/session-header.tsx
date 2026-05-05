import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const prompt = usePrompt()
  const platform = usePlatform()
  const language = useLanguage()
  const sync = useSync()
  const { view } = useSessionLayout()
  const skills = createMemo(() =>
    sync.data.command
      .filter((cmd) => cmd.source === "skill")
      .map((cmd) => ({ name: cmd.name, description: cmd.description }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const isDesktopBeta = platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const tree = createMemo(() => !isDesktopBeta)

  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    setRightMount(document.getElementById("opencode-titlebar-right"))
  })

  const select = (name: string) => {
    const text = `/${name} `
    const images = prompt.current().filter((part) => part.type === "image")
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }, ...images], text.length)
    command.trigger("input.focus")
  }

  return (
    <Show when={rightMount()}>
      {(mount) => (
        <Portal mount={mount()}>
          <div class="flex items-center gap-2">
            <Show when={skills().length > 0}>
              <div class="hidden md:flex items-center gap-0.5 max-w-[min(30vw,320px)] overflow-x-auto no-scrollbar px-1">
                <For each={skills()}>
                  {(skill) => (
                    <Tooltip
                      placement="bottom"
                      inactive={!skill.description}
                      value={<div class="max-w-72">{skill.description}</div>}
                    >
                      <Button
                        variant="ghost"
                        size="small"
                        class="h-6 w-32 px-1.5 text-11-regular text-text-base shrink-0"
                        onClick={() => select(skill.name)}
                        aria-label={`/${skill.name}`}
                      >
                        <span class="truncate">{skill.name}</span>
                      </Button>
                    </Tooltip>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex items-center gap-1">
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
