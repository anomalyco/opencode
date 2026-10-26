import { Browser } from "../browser/contract"
import { Extension } from "../sdk"
import en from "./i18n/en"

export default Extension.define({
  id: "sources",
  // Results open in the desktop browser pane when there is one, else in the system browser.
  uses: { browser: Browser },
  i18n: { en },
})
