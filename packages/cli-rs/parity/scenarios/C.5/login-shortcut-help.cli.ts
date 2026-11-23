import { defineCli } from "../../cli/run"

// The hidden `login` shortcut has its own help, with `auth login`'s arguments and flags.
export default defineCli({ args: ["login", "--help"] })
