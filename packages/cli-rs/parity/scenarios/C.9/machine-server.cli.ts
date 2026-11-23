// `machine` with `--server` after the subcommand, between the group and the subcommand, or before the group: it
// talks to that server even with the background service disabled. `--standalone` is refused, as a machine needs a
// server that keeps running.
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { defineCli } from "../../cli/run"
import type { Logged } from "../../lib/fake-server"
import { env, info, script, writeConfig } from "../C.8/fixture"

// The fake server's URL is known only at setup, so the shell reads it from a file there.
const server = "__SERVER__"

export default defineCli({
  args: [],
  command: (side) =>
    script([
      ["machine", "list", "--server", server],
      ["machine", "--server", server, "add", "gpu"],
      ["--server", server, "machine", "remove", "gpu"],
      ["machine", "list", "--standalone"],
    ])(side).map((arg) => arg.replaceAll(`'${server}'`, `"$(cat ../server-url)"`)),
  env,
  server: {
    version: false,
    routes: [
      info(["http://127.0.0.1:4096", "https://example.com"]),
      {
        method: "POST",
        path: "/api/experimental/machine",
        json: (entry: Logged) => ({
          data: { name: (entry.body as { name: string }).name, join: "ocjoin_example", expires: 1767268800000 },
        }),
      },
      { path: "/api/experimental/machine", json: { data: [{ id: "gpu", paired: true, online: false }] } },
      { method: "DELETE", path: "/api/experimental/machine/:name", status: 204 },
    ],
  },
  setup: async (root, url) => {
    await writeConfig(root, { disabled: true })
    await writeFile(path.join(root, "server-url"), url ?? "")
  },
})
