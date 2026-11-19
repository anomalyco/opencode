import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"
import active from "./icons/active.svg?raw"
import complete from "./icons/complete.svg?raw"
import paused from "./icons/paused.svg?raw"

// The pill's glyph of each goal status. Each is framed to its 14px ring, the size of a pill's icon, so it draws at
// full size there.
export default Plugin.define({
  icons: { active, paused, complete },
  i18n: builtinCatalog({
    en,
    zh: () => import("./i18n/zh"),
  }),
})
