// `machine` against the registered service: `add` prints only the join string off a terminal and sends the server's
// URLs as link addresses, reachable ones first (or the `--url` given alone); `list` aligns its columns; `remove`
// confirms; the bare group prints its help.
import { defineCli } from "../../cli/run"
import type { Logged } from "../../lib/fake-server"
import { env, info, register, script } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: script([
    ["machine", "add", "gpu"],
    ["machine", "add", "gpu", "--replace", "--url", "https://override.example.com:8443/"],
    ["machine", "list"],
    ["machine", "remove", "gpu"],
    ["machine"],
  ]),
  env,
  server: {
    version: false,
    routes: [
      info(["http://127.0.0.1:4096", "http://192.168.1.20:4096", "https://example.com"]),
      {
        method: "POST",
        path: "/api/experimental/machine",
        json: (entry: Logged) => ({
          data: { name: (entry.body as { name: string }).name, join: "ocjoin_example", expires: 1767268800000 },
        }),
      },
      {
        path: "/api/experimental/machine",
        json: {
          data: [
            { id: "gpu", paired: true, online: true, os: "linux", arch: "x64" },
            { id: "laptop", paired: true, online: false },
            { id: "worker", paired: false, online: false, os: "darwin" },
          ],
        },
      },
      { method: "DELETE", path: "/api/experimental/machine/:name", status: 204 },
    ],
  },
  setup: register,
})
