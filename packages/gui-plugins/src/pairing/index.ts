import { Plugin } from "@opencode/plugin/gui"
import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import en from "./i18n/en"
import pair from "./icons/pair.svg?raw"

export default Plugin.define({
  icons: { pair },
  i18n: builtinCatalog({ en, da: () => import("./i18n/da") }),
})
