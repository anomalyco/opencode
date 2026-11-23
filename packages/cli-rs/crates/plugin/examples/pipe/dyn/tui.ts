// Registers the command count in the configured file so the harness can change registrations without editing the
// plugin.

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
