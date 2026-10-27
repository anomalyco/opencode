import { createPromptProjectController } from "@/new-session/project/selector"
import { useNewSessionLocationDialog } from "@/new-session/location/dialog"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { useSearchParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, on, untrack } from "solid-js"
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
  const layout = useLayout()

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
  })
  // Focus once the draft loads. restoreFocus reads the stored cursor, so tracking it here would reapply
  // a stale cursor a frame after every key-up and yank the caret from a key pressed in that frame.
  createEffect(
    on(composer.ready, (ready) => {
      if (!ready) return

      // Search projects opened this draft; the picker returns focus to the composer when it closes.
      if (layout.draft.projectSearch.take()) location()
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
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <div class="flex-1 min-h-0 flex flex-col gap-2 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
        <NewSessionView composer={model} project={project} workspace={workspace} location={location} />
      </div>
    </div>
  )
}
