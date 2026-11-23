// The server cannot be reached: the connection error as a JSON envelope, exit 1.
import { defineCli } from "../../cli/run"
import { nowMask } from "./fixture"

export default defineCli({
  args: ["run", "--format", "json", "hello", "--server", "http://127.0.0.1:9"],
  // The cause after the address is the HTTP stack's own text (Bun's fetch, reqwest).
  masks: [nowMask, { pattern: /(Could not reach server at [^ ]+:) .*?"\}/, replacement: '$1 <cause>"}' }],
  stderrLines: 0,
})
