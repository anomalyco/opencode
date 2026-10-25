import { createPromptProjectController } from "@/new-session/project/selector"
import { useSettingsSurface } from "@/settings/surface"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { useSettingsServers } from "@/settings/servers/inventory"
import { useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, on, onCleanup, Show, untrack } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { createMountedSession } from "@/runtime/extension/mounted-session"
import { createPanelSidebar, createRegion } from "@/runtime/extension/panels"
import { SideRegion } from "@/runtime/extension/side-region"
import { ExtensionLinks, ExtensionSlot } from "@/runtime/extension/render"
import { useExtensionAttachment } from "@/runtime/extension/attachment"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionScreenLayout } from "@/session/screen-layout"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createComposerModel } from "@/composer/model"
import { useComposerCommands } from "@/composer/commands"
import { createNewSessionComposerAdapter } from "./composer-adapter"
import { NewSessionView } from "./view"
import { createNewSessionWorkspaceController } from "./workspace/controller"
import { useNewSessionCommands } from "./commands"
import { createDraftMcpControls } from "./mcp"

/** The draft-only Session page. Submitting promotes the draft into a real Session. */
export default function NewSessionPage(props: { draftId: string }) {
  const [search, setSearch] = useSearchParams<{ draftId?: string; prompt?: string }>()
  const tabs = useTabs()
  const servers = useSettingsServers()
  const settingsSurface = useSettingsSurface()
  tabs.reserveDraft(props.draftId)

  const layout = useSessionLayout()
  const location = useWorkspaceLocation()
  const attachment = useExtensionAttachment()
  const isDesktop = createMediaQuery("(min-width: 768px)")

  const mounted = createMountedSession({
    draft: true,
    identity: { sessionID: layout.sessionID },
    workspace: { directory: () => location().directory },
    layout,
  })

  const sidebar = createPanelSidebar()

  const region = createRegion({
    region: "side",
    view: mounted.view,
    screen: mounted.screen,
    tabs: layout.tabs,
    onEmpty: () => {
      if (layout.view().side.opened()) layout.view().side.toggle()
    },
  })

  onCleanup(attachment.region(region))

  const screen = createSessionScreenLayout(
    { isDesktop, layout },
    { wide: region.wide, sidebar: () => false, tabs: () => region.keys().length > 0 },
  )

  const draftTab = createMemo(() =>
    tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId),
  )

  const openWorkspaces = () => {
    const draft = draftTab()

    if (servers().length > 1 && draft) {
      settingsSurface.openServer(draft.server, "workspaces")

      return
    }

    settingsSurface.open("workspaces")
  }

  const workspace = createNewSessionWorkspaceController({
    selectedWorktree: () => draftTab()?.worktree,
    selectedBranch: () => draftTab()?.branch,
    setSelectedWorktree: (worktree) => {
      if (search.draftId) tabs.updateDraft(search.draftId, { worktree })
    },
    setSelectedBranch: (branch) => {
      if (search.draftId) tabs.updateDraft(search.draftId, { branch })
    },
    onViewAll: openWorkspaces,
  })

  const mcp = createDraftMcpControls({ draftID: props.draftId, worktree: workspace.selection.value })

  const composer = createNewSessionComposerAdapter({
    draftID: props.draftId,
    worktree: workspace.selection.value,
    branch: workspace.bar.branch,
    submitted: workspace.selection.remember,
    mcp,
  })

  const model = createComposerModel(composer.adapter)
  useComposerCommands({ model: composer.model })

  const project = createPromptProjectController({
    controls: composer.project,
    onDone: model.restoreFocus,
  })

  useNewSessionCommands({
    restoreFocus: model.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
    workspace: {
      enabled: workspace.bar.visible,
      cycle: workspace.selection.cycle,
    },
  })
  // Focus once the draft loads. restoreFocus reads the stored cursor, so tracking it here would reapply
  // a stale cursor a frame after every key-up and yank the caret from a key pressed in that frame.
  createEffect(
    on(composer.ready, (ready) => {
      if (ready) model.restoreFocus()
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
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <ExtensionLinks session={mounted.view()}>
        <div class="flex-1 min-h-0 flex gap-2 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
          <div ref={screen.panel.ref} class="relative flex-1 min-h-0 min-w-0 flex gap-2">
            <div class="relative min-w-0 shrink-0 h-full" style={{ width: screen.panel.width() }}>
              <NewSessionView composer={model} project={project} workspace={workspace} />
              <Show when={isDesktop()}>
                <div class="absolute end-3 top-0 z-30 h-12 flex items-center">
                  <ExtensionSlot
                    at="session.panel.toggle"
                    input={{ session: mounted.view(), screen: mounted.screen }}
                  />
                </div>
              </Show>
              <Show when={screen.panel.resizable()}>
                <ResizeHandle
                  class="-end-1"
                  direction="horizontal"
                  size={screen.panel.resizedWidth()}
                  min={SESSION_PANEL_WIDTH_MIN}
                  max={screen.panel.max()}
                  onResize={layout.view().session.resize}
                />
              </Show>
            </div>
            <Show when={screen.side.tabs.open()}>
              <SideRegion
                screen={mounted.screen}
                view={mounted.view()}
                region={region}
                sidebar={sidebar}
                fileTree={false}
                size={screen.size}
              />
            </Show>
          </div>
        </div>
      </ExtensionLinks>
    </div>
  )
}
