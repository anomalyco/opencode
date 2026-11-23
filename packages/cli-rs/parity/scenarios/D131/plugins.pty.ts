// `/plugins` under the new designs, the only ones Rust draws (X02): the list fills `floor(rows / 2) - 6` rows and
// an overflowing list cuts off (#64934). A release starts with these designs (#64988; `designs.pty.ts`).
import { definePty } from "../../pty/run"
import { plugins } from "./plugins"

export default definePty(plugins({ experimental: { "new-designs": true } }))
