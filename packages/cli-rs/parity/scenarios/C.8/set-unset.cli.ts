// Edits with no service running (nothing to stop), then the file both clients wrote, key order included.
import { defineCli } from "../../cli/run"
import { env, script, writeConfig } from "./fixture"

export default defineCli({
  args: [],
  command: script(
    [
      ["service", "set", "port", "0x1388"],
      ["service", "set", "hostname", "0.0.0.0"],
      ["service", "set", "env", "B", "1"],
      ["service", "set", "env", "A", "2"],
      ["service", "set", "cors", "http://a.test, https://b.test:8443"],
      ["service", "set", "password", "pw"],
      ["service", "set", "disabled", "true"],
      ["service", "set", "disabled", "false"],
      ["service", "set", "remote", "false"],
      ["service", "unset", "env", "B"],
      ["service", "unset", "hostname"],
      ["service", "unset", "disabled"],
      ["service", "get"],
    ],
    { cat: true },
  ),
  env,
  setup: (root) => writeConfig(root, { remote: { route: "0123456789abcdef" }, port: 1 }),
})
