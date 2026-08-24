import { createPromptProjectController } from "@/new-session/project/selector"
import { useSettingsDialog } from "@/settings/command"
import { useSettings } from "@/settings/model"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, untrack } from "solid-js"
import { createComposerModel } from "@/composer/model"
import { useComposerCommands } from "@/composer/commands"
import { createNewSessionComposerAdapter } from "./composer-adapter"
import { NewSessionStatus, NewSessionView } from "./view"
import { createNewSessionWorkspaceController } from "./workspace/controller"
import { useNewSessionCommands } from "./commands"

/** The draft-only Session page. Submitting promotes the draft into a real Session. */
export default function NewSessionPage(props: { draftId: string }) {
  const settings = useSettings()
  const [search, setSearch] = useSearchParams<{ draftId?: string; prompt?: string }>()
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
  const composer = createNewSessionComposerAdapter({
    draftID: props.draftId,
    worktree: workspace.selection.value,
    submitted: workspace.selection.remember,
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
  })
  createEffect(() => {
    if (!composer.ready()) return
    model.restoreFocus()
  })
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
      <NewSessionStatus visible={settings.visibility.status()} />
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <NewSessionView composer={model} project={project} workspace={workspace} />
      </div>
    </div>
  )
}
