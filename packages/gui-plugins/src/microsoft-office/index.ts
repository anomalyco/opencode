import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"
import ru from "./i18n/ru"

/** Read-only previews of Word, Excel and PowerPoint files in the file view. */
export default Plugin.define({
  i18n: { en, ru },
})
