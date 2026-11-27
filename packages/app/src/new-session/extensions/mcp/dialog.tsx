import { useLanguage } from "@/runtime/i18n/language"
import { useNewSessionExtensionListDialog } from "../list-dialog"
import type { NewSessionMcps } from "./controller"

/** Opens the dialog that chooses which MCP servers the draft's session starts with. */
export function useNewSessionMcpsDialog(input: { mcps: NewSessionMcps; onDone: () => void }) {
  const language = useLanguage()

  return useNewSessionExtensionListDialog({
    list: input.mcps,
    status: true,
    onDone: input.onDone,
    copy: () => ({
      title: language.t("dialog.mcp.title"),
      placeholder: language.t("dialog.mcp.search.placeholder"),
      empty: language.t("dialog.mcp.empty"),
      searchEmpty: language.t("dialog.mcp.search.empty"),
    }),
  })
}
