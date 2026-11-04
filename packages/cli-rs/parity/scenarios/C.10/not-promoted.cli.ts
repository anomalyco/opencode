// The prompt never reaches the message list: once the stream ends the execution, "Prompt was not
// promoted", exit 1. (Without an event after the wait, TS waits forever; so does Rust.)
import { defineCli } from "../../cli/run"
import { server, succeeded } from "./fixture"

export default defineCli({
  args: ["run", "hello"],
  server: server({ delivered: false, listed: false, end: null, late: [succeeded()] }),
})
