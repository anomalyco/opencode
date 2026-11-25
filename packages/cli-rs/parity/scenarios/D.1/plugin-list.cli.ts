// `plugin list --builtin` against a fake server: the server's plugins as a table, read by the delegated TS CLI
// through the `--server` argument it was given.
import { defineCli } from "../../cli/run"
import { env } from "./ts"

const location = { directory: "/work", project: { id: "proj_test", directory: "/work", canonical: "/work" } }
const features = { server: true }
const state = { status: "active" }

export default defineCli({
  args: ["plugin", "list", "--builtin"],
  env,
  server: {
    routes: [
      {
        path: "/api/plugin",
        json: {
          location,
          data: [
            { id: "opencode.core", source: { type: "builtin" }, features, state },
            { id: "acme", source: { type: "package", target: "acme-plugin", version: "1.2.0" }, features, state },
            { id: "mine", source: { type: "local", path: "/work/plugins/mine" }, features, state },
          ],
        },
      },
    ],
  },
})
