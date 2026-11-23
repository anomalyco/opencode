// The errors before anything connects: --remote with --url, and the disabled service. (An invalid --url is a
// usage error, which the Rust parser reports in its own format; see the C.8 report.)
import { defineCli } from "../../cli/run"
import { env, script, writeConfig } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: script([
    ["pair", "--remote", "--url", "https://example.com"],
    ["pair"],
  ]),
  env,
  setup: (root) => writeConfig(root, { disabled: true }),
})
