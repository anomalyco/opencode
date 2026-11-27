import { defineCli } from "../../cli/run"
import { futureRoutes, sink } from "./fixture"

// `auth login --answer` for a field of a type this client does not know (a newer server's): the answer is
// decoded as JSON, checked as a selection, and sent with the OAuth start. (TS throws a TypeError for a
// non-empty selection, so only an empty one compares.)
export default defineCli({
  args: ["auth", "login", "future", "--answer", "region=[]"],
  env: sink,
  server: { routes: futureRoutes({}) },
})
