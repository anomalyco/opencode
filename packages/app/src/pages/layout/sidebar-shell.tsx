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
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { WORKSPACES_HIDDEN } from "@/constants/feature-flags"

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
  renderPanel: () => JSX.Element
}): JSX.Element => {
  const language = useLanguage()
  const showRail = createMemo(() => props.projects().length > 1)
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
  let panel: HTMLDivElement | undefined

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
      <Show when={!WORKSPACES_HIDDEN}>
        <div
          data-component="sidebar-rail"
          class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
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
              <div class="h-full w-full flex flex-col items-center gap-3 px-1 py-3 overflow-y-auto no-scrollbar">
                <div class="shrink-0 w-full text-[9px] font-medium tracking-wider text-text-weak uppercase text-center leading-tight">
                  <Show
                    when={language.t("sidebar.heading.workspaces").length > 6}
                    fallback={language.t("sidebar.heading.workspaces")}
                  >
                    <div>{language.t("sidebar.heading.workspaces").slice(0, 6)}</div>
                    <div>{language.t("sidebar.heading.workspaces").slice(6)}</div>
                  </Show>
                </div>
                <Show when={showRail()}>
                  <SortableProvider ids={props.projects().map((p) => p.worktree)}>
                    <For each={props.projects()}>{(project) => props.renderProject(project)}</For>
                  </SortableProvider>
                </Show>
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
        </div>
      </Show>

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
