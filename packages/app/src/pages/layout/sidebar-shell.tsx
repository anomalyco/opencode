import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import type { IconName } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { type LocalProject } from "@/context/layout"

export type SidebarExtraAgent = {
  id: string
  label: Accessor<string>
  active?: Accessor<boolean>
  healthy?: Accessor<boolean | undefined>
  icon: IconName
  onOpen: () => void
}

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  extraAgents: Accessor<SidebarExtraAgent[]>
  configLabel: Accessor<string>
  onOpenConfig: () => void
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
  let panel: HTMLDivElement | undefined

  // Extra agents menu state
  const [menuOpen, setMenuOpen] = createSignal(false)
  let closeTimer: number | undefined

  const activeAgent = createMemo(() => props.extraAgents().find((agent) => agent.active?.()))
  // GeneralAgent is the framework shell entry. The rail always shows a stable
  // framework icon; which backend is active is a domain-internal detail revealed
  // by the popover selector below.
  const entryIcon = createMemo<IconName>(() => (props.extraAgents().length > 0 ? "robot" : "dot-grid"))

  const handleMenuMouseEnter = () => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
    setMenuOpen(true)
  }

  const handleMenuMouseLeave = () => {
    closeTimer = window.setTimeout(() => {
      setMenuOpen(false)
    }, 200)
  }

  onCleanup(() => {
    if (closeTimer) {
      clearTimeout(closeTimer)
    }
  })

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
      >
        <div class="flex-1 min-h-0 w-full">
          <DragDropProvider
            onDragStart={props.handleDragStart}
            onDragEnd={props.handleDragEnd}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div class="h-full w-full flex flex-col items-center gap-3 px-3 py-3 overflow-y-auto no-scrollbar">
              <SortableProvider ids={props.projects().map((p) => p.worktree)}>
                <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
              </SortableProvider>
              <Tooltip
                placement={placement()}
                value={
                  <div class="flex items-center gap-2">
                    <span>{props.openProjectLabel}</span>
                    <Show when={!props.mobile && !!props.openProjectKeybind()}>
                      <span class="text-icon-base text-12-medium">{props.openProjectKeybind()}</span>
                    </Show>
                  </div>
                }
              >
                <IconButton
                  icon="plus"
                  variant="ghost"
                  size="large"
                  onClick={props.onOpenProject}
                  aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
                />
              </Tooltip>
            </div>
            <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
          </DragDropProvider>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <Show when={props.extraAgents().length > 0}>
            <Popover
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              placement={placement()}
              trigger={
                <div onMouseEnter={handleMenuMouseEnter} onMouseLeave={handleMenuMouseLeave}>
                  <Tooltip placement={placement()} value="GeneralAgent">
                    <IconButton
                      icon={entryIcon()}
                      variant="ghost"
                      size="large"
                      classList={{ "bg-surface-base-active": !!activeAgent() }}
                      aria-label="GeneralAgent"
                    />
                  </Tooltip>
                </div>
              }
            >
              <div
                class="flex flex-col gap-1 p-2 min-w-[160px]"
                onMouseEnter={handleMenuMouseEnter}
                onMouseLeave={handleMenuMouseLeave}
              >
                <For each={props.extraAgents()}>
                  {(agent) => (
                    <button
                      class="flex items-center gap-2 px-3 py-2 rounded-md text-text-base hover:bg-surface-base-hover transition-colors"
                      classList={{
                        "bg-surface-base-active": !!agent.active?.(),
                      }}
                      onClick={() => {
                        agent.onOpen()
                        setMenuOpen(false)
                      }}
                    >
                      <Icon name={agent.icon} class="size-5 shrink-0" />
                      <span class="text-14-regular flex-1 text-left">{agent.label()}</span>
                      <Show when={agent.healthy}>
                        <span
                          aria-hidden="true"
                          class="size-1.5 shrink-0 rounded-full"
                          classList={{
                            "bg-icon-success-base": agent.healthy?.() === true,
                            "bg-icon-critical-base": agent.healthy?.() === false,
                            "bg-border-weak-base": agent.healthy?.() === undefined,
                          }}
                        />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Popover>
          </Show>
          <Tooltip placement={placement()} value={props.configLabel()}>
            <IconButton
              icon="sliders"
              variant="ghost"
              size="large"
              onClick={props.onOpenConfig}
              aria-label={props.configLabel()}
            />
          </Tooltip>
          <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              onClick={props.onOpenSettings}
              aria-label={props.settingsLabel()}
            />
          </TooltipKeybind>
          <Tooltip placement={placement()} value={props.helpLabel()}>
            <IconButton
              icon="help"
              variant="ghost"
              size="large"
              onClick={props.onOpenHelp}
              aria-label={props.helpLabel()}
            />
          </Tooltip>
        </div>
      </div>

      <div
        ref={(el) => {
          panel = el
        }}
        classList={{ "flex-1 flex h-full min-h-0 min-w-0 overflow-hidden": true, "pointer-events-none": !expanded() }}
        aria-hidden={!expanded()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
