import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"

/** Read-only previews of Word, Excel and PowerPoint files in the file view. */
export default Plugin.define({
  i18n: builtinCatalog({
    en,
    zh: () => import("./i18n/zh"),
  }),
})
