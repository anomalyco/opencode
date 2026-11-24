// `debug paths db` with a relative `OPENCODE_DB`, which resolves against the data directory.
import { defineCli } from "../../cli/run"

export default defineCli({
  args: ["debug", "paths", "db"],
  env: { OPENCODE_DB: "../custom/./my.db" },
})
