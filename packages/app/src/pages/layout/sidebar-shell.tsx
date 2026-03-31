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
import { Icon } from "@opencode-ai/ui/icon"
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
  const placement = () => (props.mobile ? "bottom" : "right")

  return (
    <div class="flex flex-col h-full w-full min-w-0 bg-background-base">
      {/* Header + Toolbar */}
      <div class="shrink-0 px-4 py-3 border-b border-border-weaker-base">
        <div class="flex items-center justify-between">
          <span class="text-14-medium text-text-strong">Threads</span>
          <div class="flex items-center gap-1">
            <Tooltip placement={placement()} value="Filter">
              <IconButton
                icon="sliders"
                variant="ghost"
                size="small"
                aria-label="Filter"
              />
            </Tooltip>
            <Tooltip placement={placement()} value="Sort">
              <IconButton
                icon="selector"
                variant="ghost"
                size="small"
                aria-label="Sort"
              />
            </Tooltip>
            <Tooltip placement={placement()} value="View">
              <IconButton
                icon="eye"
                variant="ghost"
                size="small"
                aria-label="View"
              />
            </Tooltip>
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
                size="small"
                onClick={props.onOpenProject}
                aria-label={typeof props.openProjectLabel === "string" ? props.openProjectLabel : undefined}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Projects List (scrollable) */}
      <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <DragDropProvider
          onDragStart={props.handleDragStart}
          onDragEnd={props.handleDragEnd}
          onDragOver={props.handleDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragXAxis />
          <div class="py-2">
            <SortableProvider ids={props.projects().map((p) => p.worktree)}>
              <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
            </SortableProvider>
          </div>
          <DragOverlay>{props.renderProjectOverlay()}</DragOverlay>
        </DragDropProvider>
      </div>

      {/* Bottom: Settings + Help */}
      <div class="shrink-0 border-t border-border-weaker-base px-2 py-3 flex flex-col gap-1">
        <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
          <button
            type="button"
            onClick={props.onOpenSettings}
            class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-base-hover w-full text-left"
            aria-label={props.settingsLabel()}
          >
            <Icon name="settings-gear" size="small" class="text-icon-base" />
            <span class="text-14-regular text-text-strong flex-1">{props.settingsLabel()}</span>
          </button>
        </TooltipKeybind>
        <Tooltip placement={placement()} value={props.helpLabel()}>
          <button
            type="button"
            onClick={props.onOpenHelp}
            class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-base-hover w-full text-left"
            aria-label={props.helpLabel()}
          >
            <Icon name="help" size="small" class="text-icon-base" />
            <span class="text-14-regular text-text-strong flex-1">{props.helpLabel()}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
