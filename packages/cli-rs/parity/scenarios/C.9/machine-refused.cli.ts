// The server's refusals, each with what to do: machines turned off (403) and a machine that is already paired (409).
import { defineCli } from "../../cli/run"
import { env, info, register, script } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: script([
    ["machine", "list"],
    ["machine", "add", "gpu"],
  ]),
  env,
  server: {
    version: false,
    routes: [
      info([]),
      {
        path: "/api/experimental/machine",
        status: 403,
        json: { _tag: "ForbiddenError", message: "Machines are disabled" },
      },
      {
        method: "POST",
        path: "/api/experimental/machine",
        status: 409,
        json: { _tag: "ConflictError", resource: "gpu", message: "Machine gpu is already paired" },
      },
    ],
  },
  setup: register,
})
