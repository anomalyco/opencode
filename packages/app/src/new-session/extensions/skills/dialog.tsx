import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { NewSessionExtensionListDialog } from "../list-dialog"
import type { NewSessionSkills } from "./controller"

/** Opens the dialog that chooses which skills the draft's session starts with. */
export function useNewSessionSkillsDialog(input: { skills: NewSessionSkills; onDone: () => void }) {
  const dialog = useDialog()

  return () => void dialog.show(() => <NewSessionSkillsDialog skills={input.skills} />, input.onDone)
}

function NewSessionSkillsDialog(props: { skills: NewSessionSkills }) {
  const language = useLanguage()

  return (
    <NewSessionExtensionListDialog
      list={props.skills}
      title={language.t("settings.extensions.tab.skills")}
      placeholder={language.t("session.new.skills.search.placeholder")}
      empty={language.t("session.new.skills.empty")}
      searchEmpty={language.t("session.new.skills.search.empty")}
    />
  )
}
