// `/plugins` under the new designs, the only ones Rust draws (X02): the list fills `floor(rows / 2) - 6` rows,
// and an overflowing list gives its last row to a "…" indicator until the end of the list shows.
import { definePty } from "../../pty/run"
import { plugins } from "./plugins"

export default definePty(plugins({ experimental: { "new-designs": true } }))
