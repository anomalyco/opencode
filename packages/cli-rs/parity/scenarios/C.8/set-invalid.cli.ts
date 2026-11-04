// Validation and usage errors of `set` and `unset`; none of them changes the file.
import { defineCli } from "../../cli/run"
import { env, script, writeConfig } from "./fixture"

export default defineCli({
  args: [],
  command: script(
    [
      ["service", "set", "port", "abc"],
      ["service", "set", "port", "65536"],
      ["service", "set", "port", "1", "2"],
      ["service", "set", "disabled", "yes"],
      ["service", "set", "remote", "maybe"],
      ["service", "set", "cors", "http://a.test/"],
      ["service", "set", "env", "A"],
      ["service", "set", "nope", "1"],
      ["service", "unset", "env"],
      ["service", "unset", "port", "x"],
      ["service", "unset", "nope"],
    ],
    { cat: true },
  ),
  env,
  setup: (root) => writeConfig(root, { port: 5000 }),
})
