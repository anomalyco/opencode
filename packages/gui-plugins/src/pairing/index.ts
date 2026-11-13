import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"

export default Plugin.define({
  i18n: builtinCatalog({
    en,
    fr: () => import("./i18n/fr"),
  }),
})
