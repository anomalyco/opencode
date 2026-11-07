import { useCommand, type CommandOption } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { DialogSelectModel } from "@/providers/models/select-dialog"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useDialog } from "@opencode/ui/context/dialog"
import { useSessionLayout } from "@/session/session-layout"
import { createSessionOwnership } from "@/session/session-ownership"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { toaster } from "@opencode/ui/toast"

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useComposerCommands = (input: { model?: ModelSelection } = {}) => {
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const workspace = useWorkspaceLocation()
  const { sessionKey, params } = useSessionLayout()
  const data = useData()
  const sdk = useServerSDK()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const model = input.model ?? local.model
  const modelCommand = withCategory(language.t("command.category.model"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const providerCommand = withCategory(language.t("command.category.provider"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const serverCommand = withCategory(language.t("command.category.server"))

  // Mirrors the TUI's `/connect`, which the Console's setup steps tell people to run.
  const connectProvider = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    // Like the TUI, the model chosen after connecting applies to this composer.
    void dialog.show(() => <DialogConnectProvider directory={workspace().directory} selection={model} />)
  }

  // Mirrors the TUI's `/reload`. The server rebuilds every loaded location and announces the changed agents,
  // commands, models and skills, so the data layer refreshes them without restarting the app.
  const reloadConfig = () => {
    const pending = showToast({
      variant: "loading",
      title: language.t("command.config.reload.pending"),
      persistent: true,
    })

    void sdk.api.location
      .reload()
      .then(() => showToast({ variant: "success", title: language.t("command.config.reload.done") }))
      .catch((error) =>
        showToast({
          variant: "error",
          title: language.t("command.config.reload.failed"),
          description: formatServerError(error, language.t),
        }),
      )
      .finally(() => toaster.dismiss(pending))
  }

  const chooseModel = () => {
    sessionOwnership.capture().run(() => {
      void dialog.show(() => <DialogSelectModel model={model} />)
    })
  }

  const viewUsage = async () => {
    const { DialogUsage } = await import("@/usage/dialog")
    const current = model.current()

    // Console refuses with 402 only when the workspace can't pay, which the dialog explains.
    const last = params.id
      ? data.session.message.list(params.id)?.findLast((message) => message.type === "assistant")
      : undefined

    void dialog.show(() => (
      <DialogUsage
        location={workspace().ref}
        model={current && { providerID: current.provider.id, modelID: current.id, name: current.name }}
        credits={last?.type === "assistant" && last.error?.status === 402}
        onSwitchModel={chooseModel}
      />
    ))
  }

  command.register("composer", () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => model.variant.cycle(),
    }),
    viewCommand({
      id: "usage.view",
      title: language.t("command.usage.view"),
      description: language.t("command.usage.view.description"),
      onSelect: () => void viewUsage(),
    }),
    providerCommand({
      id: "provider.connect",
      title: language.t("command.provider.connect"),
      description: language.t("command.provider.connect.description"),
      slash: "connect",
      onSelect: connectProvider,
    }),
    serverCommand({
      id: "config.reload",
      title: language.t("command.config.reload"),
      description: language.t("command.config.reload.description"),
      slash: "reload",
      onSelect: reloadConfig,
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      disabled: !local.agent.visible(),
      onSelect: () => local.agent.move(-1),
    }),
  ])
}
