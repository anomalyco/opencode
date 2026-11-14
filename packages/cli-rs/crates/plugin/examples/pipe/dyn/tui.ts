// A plugin whose registrations follow a file outside it, for the pipe's tests (P7, review carbon-2): its setup reads
// the count the file at its `file` option holds and registers that many commands, `dyn.c1` to `dyn.c<n>`, each toasting
// its name. Set up again on a new JS host after the file changed, it registers others than the host has.

import { readFileSync } from "node:fs"

export default {
  id: "example.dyn",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const count = Number(readFileSync(api.options.file, "utf8")) || 0
    for (let index = 1; index <= count; index++) {
      const name = `dyn.c${index}`
      carrier.command({ name, title: name }, () => api.ui.toast.show({ message: name }))
    }
  },
}
