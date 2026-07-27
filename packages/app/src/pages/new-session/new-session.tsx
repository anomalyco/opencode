import type { PromptProjectController } from "@/components/prompt-project-selector"
import { PromptProjectAddButton, PromptProjectSelector } from "@/components/prompt-project-selector"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useTitlebarRightMount } from "@/components/titlebar"
import type { NewSessionCommandController } from "./new-session-command-controller"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import { NewSessionView } from "./new-session-view"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

export function NewSession(props: {
  draft: NewSessionDraftController
  commands: NewSessionCommandController
  workspace: NewSessionWorkspaceController
  project: PromptProjectController
}) {
  const language = useLanguage()
  const settings = useSettings()
  const rightMount = useTitlebarRightMount()

  return (
    <NewSessionView
      rightMount={rightMount}
      statusVisible={settings.visibility.status}
      statusLabel={() => language.t("status.popover.trigger")}
      promptReady={props.draft.prompt.ready}
      promptReadyPromise={props.draft.prompt.readyPromise}
      restoreFocus={props.draft.input.restoreFocus}
      composer={() => <PromptInputV2Composer controller={props.draft.input} />}
      projectEmpty={props.project.empty}
      projectSelected={props.project.selected}
      projectAdd={() => <PromptProjectAddButton controller={props.project} />}
      projectSelector={() => <PromptProjectSelector controller={props.project} placement="bottom" />}
      workspaceVisible={props.workspace.bar.visible}
      workspaceValue={props.workspace.selection.value}
      workspaceRoot={props.workspace.project.root}
      workspaces={props.workspace.project.workspaces}
      branch={props.workspace.bar.branch}
      noGit={() => !props.workspace.project.git()}
      onWorkspaceChange={props.workspace.selection.set}
      providerReady={props.commands.provider.ready}
      providerConnected={props.commands.provider.connected}
      onOpenProviders={props.commands.provider.open}
    />
  )
}
