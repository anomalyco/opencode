// `upgrade --method apt`: a choice the flag does not take is a usage error before anything runs, as in TS. Past its
// parsing, `opencode-native upgrade` upgrades nothing and says how it is updated (deviation D01-upgrade), so this is
// what P-CLI can compare of it.
import { defineCli } from "../../cli/run"

export default defineCli({ args: ["upgrade", "--method", "apt"] })
