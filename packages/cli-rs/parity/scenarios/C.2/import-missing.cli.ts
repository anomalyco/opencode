// A file that does not exist: the read fails before the command connects. The error escapes the TS
// handler (C40-handler-errors); only the first stderr line is compared.
import { defineCli } from "../../cli/run"
import { location } from "./fixture"

export default defineCli({
  args: ["session", "import", "missing.json"],
  server: { routes: [location] },
  stderrLines: 1,
})
