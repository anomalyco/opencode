// `pair --remote` with remote access already on: no consent and no tunnel setup; the link is the tunnel URL from
// `/api/info` whose host is `<route>.<tunnel hostname>`, with its QR code and no SSH hint.
import { defineCli } from "../../cli/run"
import { env, info, only, pairRoute, register, tunnel, writeConfig } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: only(["pair", "--remote"]),
  env,
  server: {
    version: false,
    routes: [info(["http://127.0.0.1:4096", "https://0123456789abcdef.t1.opentunnel.test"]), pairRoute],
  },
  setup: async (root, server) => {
    await writeConfig(root, { remote: { route: "0123456789abcdef" } })
    await tunnel(root, "t1.opentunnel.test")
    await register(root, server)
  },
})
