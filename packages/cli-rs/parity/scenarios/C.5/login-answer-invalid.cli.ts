import { defineCli } from "../../cli/run"
import { integrationRoutes, sink } from "./fixture"

// `auth login --answer` with a value outside the field's options.
export default defineCli({
  args: [
    "auth",
    "login",
    "acme",
    "--answer",
    "region=mars",
    "--answer",
    "team=core",
    "--answer",
    "seats=3",
    "--answer",
    "beta=true",
    "--answer",
    "scopes=[]",
  ],
  env: sink,
  server: { routes: [...integrationRoutes()] },
})
