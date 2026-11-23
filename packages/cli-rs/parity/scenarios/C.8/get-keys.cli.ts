// `service get <key> [name]` for every key, an unknown key, a name after a key that takes none, and the
// password.
import { defineCli } from "../../cli/run"
import { env, script, writeConfig } from "./fixture"

export default defineCli({
  args: [],
  command: script([
    ["service", "get", "disabled"],
    ["service", "get", "remote"],
    ["service", "get", "hostname"],
    ["service", "get", "port"],
    ["service", "get", "cors"],
    ["service", "get", "env"],
    ["service", "get", "env", "A"],
    ["service", "get", "env", "MISSING"],
    ["service", "get", "nope"],
    ["service", "get", "port", "extra"],
    ["service", "get", "password"],
  ]),
  env,
  setup: (root) => writeConfig(root, { port: 5000, password: "secret", cors: ["https://a.example"], env: { A: "b" } }),
})
