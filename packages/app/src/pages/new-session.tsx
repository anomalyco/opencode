import { createPromptProjectController } from "@/components/prompt-project-selector"
import { useSettingsDialog } from "@/components/settings-dialog"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useSettings } from "@/context/settings"
import { useTabs, type DraftTab } from "@/context/tabs"
import { useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource } from "solid-js"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSessionStatus, NewSessionView } from "./new-session/new-session-view"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"
import { useNewSessionCommands } from "./new-session/use-new-session-commands"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage(props: { draftId: string }) {
  const settings = useSettings()
  const rightMount = useTitlebarRightMount()
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  const openWorkspaces = useSettingsDialog("workspaces")
  const draftTab = createMemo(() =>
    tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId),
  )
  const workspace = createNewSessionWorkspaceController({
    selected: () => draftTab()?.worktree,
    setSelected: (worktree) => {
      if (search.draftId) tabs.updateDraft(search.draftId, { worktree })
    },
    onViewAll: openWorkspaces,
  })
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
    draftId: props.draftId,
    onSubmit: workspace.selection.remember,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  useNewSessionCommands({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })
  createEffect(() => {
    if (!draft.prompt.ready()) return
    draft.input.restoreFocus()
  })
  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => draft.prompt.readyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <NewSessionStatus mount={rightMount()} visible={settings.visibility.status()} />
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <NewSessionView input={draft.input} project={project} workspace={workspace} />
      </div>
    </div>
  )
}
