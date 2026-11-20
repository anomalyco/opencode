import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { NewSessionExtensionListDialog } from "../list-dialog"
import type { NewSessionMcps } from "./controller"

/** Opens the dialog that chooses which MCP servers the draft's session starts with. */
export function useNewSessionMcpsDialog(input: { mcps: NewSessionMcps; onDone: () => void }) {
  const dialog = useDialog()

  return () => void dialog.show(() => <NewSessionMcpsDialog mcps={input.mcps} />, input.onDone)
}

function NewSessionMcpsDialog(props: { mcps: NewSessionMcps }) {
  const language = useLanguage()

  return (
    <NewSessionExtensionListDialog
      list={props.mcps}
      status
      title={language.t("dialog.mcp.title")}
      placeholder={language.t("dialog.mcp.search.placeholder")}
      empty={language.t("dialog.mcp.empty")}
      searchEmpty={language.t("dialog.mcp.search.empty")}
    />
  )
}
