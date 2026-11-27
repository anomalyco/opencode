// An invalid `service.json` is refused without overwriting it or stopping a running service, while `service status`
// and `machine --server` still work.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { defineCli } from "../../cli/run"
import { configFile, env, info, register, script } from "./fixture"

const server = "__SERVER__"
const raw = '{"hostname":"127.0.0.1","port":"4096","password":"keep-me","env":{"KEEP":"1"}}\n'

export default defineCli({
  args: [],
  command: (side) =>
    script(
      [
        ["service", "get"],
        ["service", "get", "password"],
        ["service", "set", "port", "4097"],
        ["service", "unset", "port"],
        ["service", "start"],
        ["service", "restart"],
        ["service", "status"],
        ["pair"],
        ["machine", "list"],
        ["machine", "list", "--server", server],
      ],
      { cat: true },
    )(side).map((arg) => arg.replaceAll(`'${server}'`, '"$(cat ../server-url)"')),
  env,
  server: {
    version: false,
    routes: [
      info(["http://127.0.0.1:4096"]),
      { path: "/api/experimental/machine", json: { data: [{ id: "gpu", paired: true, online: false }] } },
    ],
  },
  setup: async (root, url, password) => {
    await register(root, url, password)
    await mkdir(path.join(root, "home/.config/opencode"), { recursive: true })
    await writeFile(path.join(root, configFile), raw, { mode: 0o600 })
    await writeFile(path.join(root, "server-url"), url ?? "")
  },
})
