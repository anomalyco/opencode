import { createPromptProjectController } from "@/new-session/project/selector"
import { useNewSessionLocationDialog } from "@/new-session/location/dialog"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { useSearchParams } from "@solidjs/router"
import { batch, createEffect, createMemo, createResource, on, onCleanup, Show, untrack } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { createComposerModel } from "@/composer/model"
import { useComposerCommands } from "@/composer/commands"
import { createMountedSession } from "@/runtime/plugin/mounted-session"
import { createPanelSidebar, createRegion } from "@/runtime/plugin/panels"
import { createPaneDrag } from "@/runtime/plugin/pane-drag"
import { PluginLinks } from "@/runtime/plugin/render"
import { SideRegion } from "@/runtime/plugin/side-region"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { createSessionScreenLayout } from "@/session/screen-layout"
import { useSessionLayout } from "@/session/session-layout"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { SessionReviewToggle } from "@/session/header/session-header-actions"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createNewSessionComposerAdapter, createNewSessionStartStore } from "./composer-adapter"
import { NewSessionView } from "./view"
import { createNewSessionWorkspaceController } from "./workspace/controller"
import { useNewSessionCommands } from "./commands"
import { createDraftMcpControls } from "./mcp"

/** The draft-only Session page. Submitting promotes the draft into a real Session. */
export default function NewSessionPage(props: { draftId: string }) {
  const [search, setSearch] = useSearchParams<{ draftId?: string; prompt?: string }>()
  const tabs = useTabs()
  const layout = useLayout()
  // The reserved id gives the draft a stable session key, so its side region and panels survive promotion.
  tabs.reserveDraft(props.draftId)

  const sessionLayout = useSessionLayout()
  const workspaceLocation = useWorkspaceLocation()
  const attachment = usePluginAttachment()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const mounted = createMountedSession({
    identity: { sessionID: sessionLayout.sessionID },
    workspace: { directory: () => workspaceLocation().directory },
    layout: { tabKey: sessionLayout.tabKey },
    data: { isChild: () => false },
    draft: true,
  })

  const sidebar = createPanelSidebar()

  const region = createRegion({
    region: "side",
    view: mounted.view,
    screen: mounted.screen,
    tabs: sessionLayout.tabs,
    closed: attachment.closed,
    open: (key) => attachment.openTab(key, mounted.view()),
    side: () => sessionLayout.view().side,
    // Closing the last tab closes the side region, which opens with a new tab next time.
    onEmptied: () => {
      if (!sessionLayout.view().side.opened()) return
      sessionLayout.view().side.toggle()
    },
  })

  onCleanup(attachment.region(region))

  const bottomOpen = createMemo(() => region.pane("bottom").keys().length > 0 && sessionLayout.view().bottom.opened())

  const drag = createPaneDrag({
    identity: sessionLayout.tabKey,
    shown: (pane) => (pane === "bottom" ? bottomOpen() : region.pane(pane).keys().length > 0),
    drop: (key, target) =>
      batch(() => {
        sessionLayout.tabs().move(key, target.pane, target.before)

        if (target.pane === "bottom") sessionLayout.view().bottom.setOpened(true)
      }),
  })

  const screen = createSessionScreenLayout(
    { layout: { view: sessionLayout.view }, isDesktop },
    { wide: region.wide, panel: region.pane("side").selected, widths: layout.panelWidth },
  )

  const draftTab = createMemo(() =>
    tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId),
  )

  const workspace = createNewSessionWorkspaceController({
    selectedWorktree: () => draftTab()?.worktree,
    selectedBranch: () => draftTab()?.branch,
    setSelectedWorktree: (worktree) => {
      if (search.draftId) tabs.updateDraft(search.draftId, { worktree })
    },
    setSelectedBranch: (branch) => {
      if (search.draftId) tabs.updateDraft(search.draftId, { branch })
    },
  })

  const start = tabs.state(tabs.draft(props.draftId), "new-session-start", createNewSessionStartStore)

  const mcp = createDraftMcpControls({
    draftID: props.draftId,
    worktree: workspace.selection.value,
    preparing: () => start.view().preparingMcp,
  })

  const composer = createNewSessionComposerAdapter({
    draftID: props.draftId,
    worktree: workspace.selection.value,
    root: workspace.project.root,
    branch: workspace.bar.branch,
    submitted: workspace.selection.remember,
    mcp,
    start,
  })

  const model = createComposerModel(composer.adapter)
  useComposerCommands({ model: composer.model })

  const project = createPromptProjectController({ controls: composer.project })
  const location = useNewSessionLocationDialog({ project, workspace, onDone: model.restoreFocus })

  useNewSessionCommands({
    restoreFocus: model.restoreFocus,
    project: {
      empty: project.empty,
      open: () => location(),
    },
    workspace: {
      enabled: workspace.bar.visible,
      cycle: workspace.selection.cycle,
    },
    toggleReview: region.toggle,
  })
  // Focus once the draft loads. restoreFocus reads the stored cursor, so tracking it here would reapply
  // a stale cursor a frame after every key-up and yank the caret from a key pressed in that frame.
  createEffect(
    on(composer.ready, (ready) => {
      if (!ready) return

      // Search projects opened this draft; the picker returns focus to the composer when it closes.
      if (layout.draft.projectSearch.take(props.draftId)) location()
      else model.restoreFocus()
    }),
  )
  createEffect(() => {
    if (!composer.ready()) return
    untrack(() => {
      const text = search.prompt

      if (!text) return
      composer.adapter.state.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearch({ ...search, prompt: undefined })
    })
  })
  const ready = Promise.resolve()

  const [suspendUntilPromptReady] = createResource(
    () => composer.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <PluginLinks session={mounted.view()}>
      <div class="relative size-full overflow-hidden flex flex-col">
        {suspendUntilPromptReady()}
        <div class="flex-1 min-h-0 flex gap-2 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
          <div ref={screen.panel.ref} class="relative flex-1 min-h-0 min-w-0 flex gap-2">
            <div class="relative min-w-0 shrink-0 h-full" style={{ width: screen.panel.width() }}>
              <NewSessionView composer={model} project={project} workspace={workspace} location={location} />
              <Show when={isDesktop()}>
                <div class="absolute end-3 top-0 z-30 h-12 flex items-center" data-slot="session-review-toggle">
                  <SessionReviewToggle onToggle={region.toggle} />
                </div>
              </Show>
              <Show when={screen.panel.resizable()}>
                <ResizeHandle
                  class="-end-1"
                  direction="horizontal"
                  size={screen.panel.resizedWidth()}
                  min={SESSION_PANEL_WIDTH_MIN}
                  max={screen.panel.max()}
                  onResize={(width) => screen.panel.resize(width)}
                />
              </Show>
            </div>
            <Show when={screen.side.open()}>
              <SideRegion
                view={mounted.view()}
                screen={mounted.screen}
                region={region}
                sidebar={sidebar}
                show
                size={screen.size}
                contentWidth={screen.side.contentWidth}
                drag={drag}
              />
            </Show>
          </div>
        </div>
      </div>
    </PluginLinks>
  )
}
