import { createPromptProjectController } from "@/components/prompt-project-selector"
import { createNewSessionCommandController } from "./new-session/new-session-command-controller"
import { createNewSessionDraftController } from "./new-session/new-session-draft-controller"
import { NewSession } from "./new-session/new-session"
import { createNewSessionWorkspaceController } from "./new-session/new-session-workspace-controller"

/** The draft-only V2 session page. Submitting promotes the draft into a real session. */
export default function NewSessionPage() {
  const workspace = createNewSessionWorkspaceController()
  const draft = createNewSessionDraftController({
    worktree: workspace.selection.value,
    resetWorktree: workspace.selection.reset,
  })
  const project = createPromptProjectController({
    controls: draft.project.controls,
    onDone: draft.input.restoreFocus,
  })
  const commands = createNewSessionCommandController({
    restoreFocus: draft.input.restoreFocus,
    project: {
      empty: project.empty,
      open: () => project.setOpen(true),
    },
  })

  return <NewSession draft={draft} commands={commands} workspace={workspace} project={project} />
}
