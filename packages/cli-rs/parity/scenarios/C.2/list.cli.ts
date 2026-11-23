// `session list` with stdout piped: no pager; tabs and newlines in titles become spaces, a missing
// title is "Untitled session", and the project comes from the location of the working directory.
import { defineCli } from "../../cli/run"
import { list, location, sessions } from "./fixture"

export default defineCli({ args: ["session", "list"], server: { routes: [location, list(sessions)] } })
