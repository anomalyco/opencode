import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import { Pairing } from "./contract"
import en from "./i18n/en"

export default Extension.define({
  id: "pairing",
  provides: { pairing: Pairing },
  stores: {
    // Whether main keeps the display awake; stored before in the desktop's own settings namespace.
    keepScreenActive: Store.main(Schema.Boolean, false, { state: ["opencode.settings", "keepScreenActive"] }),
    // An address of this computer the server cannot see (a VPN, tunnel or proxy), and the address links use.
    links: Store.global(Schema.Struct({ custom: Schema.String, selected: Schema.String }), { custom: "", selected: "" }),
  },
  i18n: { en },
})
