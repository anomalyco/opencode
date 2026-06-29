import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
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
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  aimMove: (event: MouseEvent) => void
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const showPanel = createMemo(() => !!props.mobile)
  const placement = () => (props.mobile ? "bottom" : "right")
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (showPanel()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        classList={{
          "shrink-0 bg-background-base flex flex-col overflow-hidden transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
            true,
          "w-16 items-center": !!props.mobile,
          "w-[244px] items-stretch": !props.mobile,
        }}
        onMouseMove={props.aimMove}
      >
        <div class="flex-1 min-h-0 w-full">
          <DragDropProvider
            onDragStart={props.handleDragStart}
            onDragEnd={props.handleDragEnd}
            onDragOver={props.handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragXAxis />
            <div
              classList={{
                "h-full w-full flex flex-col gap-3 px-3 py-3 overflow-y-auto no-scrollbar": true,
                "items-center": !!props.mobile,
                "items-stretch": !props.mobile,
              }}
            >
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
        <div
          classList={{
            "shrink-0 w-full pt-3 pb-6 flex flex-col gap-2": true,
            "items-center": !!props.mobile,
            "items-stretch px-3": !props.mobile,
          }}
        >
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
        classList={{
          "flex-1 h-full min-h-0 min-w-0 overflow-hidden": true,
          flex: showPanel(),
          hidden: !showPanel(),
          "pointer-events-none": !showPanel(),
        }}
        aria-hidden={!showPanel()}
      >
        {props.renderPanel()}
      </div>
    </div>
  )
}
