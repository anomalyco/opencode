// `/plugins` with the config a release starts with, where TS draws its old designs (X02): its list keeps every row
// for plugins and shows no "…", so it lists one more plugin than Rust, and its footer hints sit one line higher with
// narrower gaps. `plugins.pty.ts` is the same list under the new designs, equal.
import { definePty } from "../../pty/run"
import { plugins } from "./plugins"

const value = plugins({})
const deviation = { file: "X02-new-designs-graduated", lines: 4 }

export default definePty({
  ...value,
  steps: value.steps.map((step) => (step.checkpoint ? { ...step, deviation } : step)),
})
