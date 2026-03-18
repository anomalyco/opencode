import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

export const useSessionTitleCommand = (input: { sessionID: () => string | undefined; open: () => void }) => {
  const command = useCommand()
  const language = useLanguage()

  command.register("session-title", () => [
    {
      id: "session.rename",
      title: `${language.t("common.rename")} ${language.t("command.category.session")}`,
      category: language.t("command.category.session"),
      disabled: !input.sessionID(),
      onSelect: input.open,
    },
  ])
}
