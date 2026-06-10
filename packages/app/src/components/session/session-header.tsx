import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { focusTerminalById } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { messageAgentColor } from "@/utils/agent"
import { decode64 } from "@/utils/base64"
import { OPEN_APPS, type OpenApp, useOpenInApp } from "@/components/session/open-in-app"
import { StatusPopover, StatusPopoverV2 } from "../status-popover"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
  const openIn = useOpenInApp({ directory: projectDirectory })
  const isDesktopV2 = createMemo(() => platform.platform === "desktop" && settings.general.newLayoutDesigns())
  const search = createMemo(() => (isDesktopV2() ? settings.general.showSearch() : true))
  const tree = createMemo(() => (isDesktopV2() ? settings.general.showFileTree() : true))
  const term = createMemo(() => (isDesktopV2() ? settings.general.showTerminal() : true))
  const status = createMemo(() => (isDesktopV2() ? settings.general.showStatus() : true))

  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return

    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  const tint = createMemo(() =>
    messageAgentColor(params.id ? sync.data.message[params.id] : undefined, sync.data.agent),
  )
  const v2ActionsState = createMemo<SessionHeaderV2ActionsState>(() => ({
    statusVisible: status(),
    statusLabel: language.t("status.popover.trigger"),
    reviewLabel: language.t("command.review.toggle"),
    reviewKeybind: command.keybind("review.toggle"),
    reviewOpened: view().reviewPanel.opened(),
    onReviewToggle: () => view().reviewPanel.toggle(),
  }))

  const [centerMount, setCenterMount] = createSignal<HTMLElement | null>(null)
  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    setCenterMount(document.getElementById("opencode-titlebar-center"))
    setRightMount(document.getElementById("opencode-titlebar-right"))
  })

  return (
    <>
      <Show when={search() && centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center overflow-visible">
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">
                    {keybind()}
                  </Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Show
              when={isDesktopV2}
              fallback={
                <div class="flex items-center gap-2">
                  <Show when={projectDirectory()}>
                    <div class="hidden xl:flex items-center">
                      <Show
                        when={openIn.canOpen()}
                        fallback={
                          <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                            <Button
                              variant="ghost"
                              class="rounded-none h-full py-0 pr-3 pl-0.5 gap-1.5 border-none shadow-none"
                              onClick={openIn.copyPath}
                              aria-label={language.t("session.header.open.copyPath")}
                            >
                              <Icon name="copy" size="small" class="text-icon-base" />
                              <span class="text-12-regular text-text-strong">
                                {language.t("session.header.open.copyPath")}
                              </span>
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex items-center">
                          <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                            <Button
                              variant="ghost"
                              class="rounded-none h-full px-0.5 border-none shadow-none disabled:!cursor-default"
                              classList={{
                                "bg-surface-raised-base-active": openIn.opening(),
                              }}
                              onClick={() => openIn.openDir(openIn.current().id)}
                              disabled={openIn.opening()}
                              aria-label={language.t("session.header.open.ariaLabel", { app: openIn.current().label })}
                            >
                              <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                                <Show when={openIn.opening()} fallback={<AppIcon id={openIn.current().icon} />}>
                                  <Spinner class="size-3.5" style={{ color: tint() ?? "var(--icon-base)" }} />
                                </Show>
                              </div>
                            </Button>
                            <DropdownMenu
                              gutter={4}
                              placement="bottom-end"
                              open={openIn.menu.open}
                              onOpenChange={(open) => openIn.setMenu("open", open)}
                            >
                              <DropdownMenu.Trigger
                                as={IconButton}
                                icon="chevron-down"
                                variant="ghost"
                                disabled={openIn.opening()}
                                class="rounded-none h-full w-[20px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active disabled:!cursor-default"
                                classList={{
                                  "bg-surface-raised-base-active": openIn.opening(),
                                }}
                                aria-label={language.t("session.header.open.menu")}
                              />
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content class="[&_[data-slot=dropdown-menu-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]+[data-slot=dropdown-menu-radio-item]]:mt-1">
                                  <DropdownMenu.Group>
                                    <DropdownMenu.GroupLabel class="!px-1 !py-1">
                                      {language.t("session.header.openIn")}
                                    </DropdownMenu.GroupLabel>
                                    <DropdownMenu.RadioGroup
                                      class="mt-1"
                                      value={openIn.current().id}
                                      onChange={(value) => {
                                        if (!OPEN_APPS.includes(value as OpenApp)) return
                                        openIn.selectApp(value as OpenApp)
                                      }}
                                    >
                                      <For each={openIn.options()}>
                                        {(o) => (
                                          <DropdownMenu.RadioItem
                                            value={o.id}
                                            disabled={openIn.opening()}
                                            onSelect={() => {
                                              openIn.setMenu("open", false)
                                              openIn.openDir(o.id)
                                            }}
                                          >
                                            <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                                              <AppIcon id={o.icon} />
                                            </div>
                                            <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                            <DropdownMenu.ItemIndicator>
                                              <Icon name="check-small" size="small" class="text-icon-weak" />
                                            </DropdownMenu.ItemIndicator>
                                          </DropdownMenu.RadioItem>
                                        )}
                                      </For>
                                    </DropdownMenu.RadioGroup>
                                  </DropdownMenu.Group>
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      openIn.setMenu("open", false)
                                      openIn.copyPath()
                                    }}
                                  >
                                    <div class="flex size-5 shrink-0 items-center justify-center">
                                      <Icon name="copy" size="small" class="text-icon-weak" />
                                    </div>
                                    <DropdownMenu.ItemLabel>
                                      {language.t("session.header.open.copyPath")}
                                    </DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
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
              }
            >
              <SessionHeaderV2Actions state={v2ActionsState()} />
            </Show>
          </Portal>
        )}
      </Show>
    </>
  )
}

type SessionHeaderV2ActionsState = {
  statusVisible: boolean
  statusLabel: string
  reviewLabel: string
  reviewKeybind: string
  reviewOpened: boolean
  onReviewToggle: () => void
}

function SessionHeaderV2Actions(props: { state: SessionHeaderV2ActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.statusVisible}>
        <Tooltip placement="bottom" value={props.state.statusLabel}>
          <StatusPopoverV2 />
        </Tooltip>
      </Show>
      <TooltipKeybind title={props.state.reviewLabel} keybind={props.state.reviewKeybind}>
        <IconButtonV2
          type="button"
          variant="ghost-muted"
          size="large"
          class="!w-9 shrink-0"
          state={props.state.reviewOpened ? "pressed" : undefined}
          onClick={props.state.onReviewToggle}
          aria-label={props.state.reviewLabel}
          aria-expanded={props.state.reviewOpened}
          aria-controls="review-panel"
          icon={<IconV2 name="sidebar-right" />}
        />
      </TooltipKeybind>
    </div>
  )
}
