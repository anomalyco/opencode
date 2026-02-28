import { type LocalProject } from "@/context/layout"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import {
  closestCenter,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { sidebarExpanded } from "./sidebar-shell-helpers"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  collapsed?: Accessor<boolean>
  onToggleCollapsed?: () => void
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
  const expanded = createMemo(() => sidebarExpanded(props.mobile, props.opened()))
  const placement = () => (props.mobile ? "bottom" : "right")
  const isCollapsed = () => !props.mobile && props.collapsed?.() === true

  return (
    <div class="flex h-full w-full overflow-hidden">
      <Show when={isCollapsed()}>
        <div class="w-8 shrink-0 flex flex-col items-center pt-3">
          <Tooltip placement="right" value="Show projects">
            <IconButton
              icon="layout-left"
              variant="ghost"
              size="small"
              onClick={props.onToggleCollapsed}
              aria-label="Show projects"
            />
          </Tooltip>
        </div>
      </Show>
      <Show when={!isCollapsed()}>
        <div class="w-16 shrink-0 flex flex-col items-center overflow-hidden" onMouseMove={props.aimMove}>
          <div class="flex-1 min-h-0 w-full">
            <DragDropProvider
              onDragStart={props.handleDragStart}
              onDragEnd={props.handleDragEnd}
              onDragOver={props.handleDragOver}
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
            <Show when={!props.mobile && props.onToggleCollapsed}>
              <Tooltip placement={placement()} value="Hide projects">
                <IconButton
                  icon="layout-left"
                  variant="ghost"
                  size="small"
                  onClick={props.onToggleCollapsed}
                  aria-label="Hide projects"
                />
              </Tooltip>
            </Show>
            <TooltipKeybind
              placement={placement()}
              title={props.settingsLabel()}
              keybind={props.settingsKeybind() ?? ""}
            >
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
      </Show>

      <Show when={expanded()}>{props.renderPanel()}</Show>
    </div>
  )
}
