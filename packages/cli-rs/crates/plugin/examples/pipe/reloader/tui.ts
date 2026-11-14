// The reload probe of the pipe's tests (P7, review bigboi-6): its command toasts what its helper module says, so an
// edit of the helper alone shows whether a reload imported the plugin's modules afresh. The test replaces this file
// with a setup that waits, or one that throws.

import { label } from "./label"

export default {
  id: "example.reloader",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    carrier.command({ name: "reloader.say", title: "reloader.say" }, () => api.ui.toast.show({ message: label() }))
  },
}
