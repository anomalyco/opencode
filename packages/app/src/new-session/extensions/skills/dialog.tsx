import { useLanguage } from "@/runtime/i18n/language"
import { useNewSessionExtensionListDialog } from "../list-dialog"
import type { NewSessionSkills } from "./controller"

/** Opens the dialog that chooses which skills the draft's session starts with. */
export function useNewSessionSkillsDialog(input: { skills: NewSessionSkills; onDone: () => void }) {
  const language = useLanguage()

  return useNewSessionExtensionListDialog({
    list: input.skills,
    onDone: input.onDone,
    copy: () => ({
      title: language.t("settings.extensions.tab.skills"),
      placeholder: language.t("session.new.skills.search.placeholder"),
      empty: language.t("session.new.skills.empty"),
      searchEmpty: language.t("session.new.skills.search.empty"),
    }),
  })
}
