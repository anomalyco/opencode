import { DialogProvider, useDialog } from "@opencode/ui/context/dialog"
import { createSimpleContext } from "@opencode/ui/context/helper"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { ErrorBoundary } from "solid-js"
import { render } from "solid-js/web"

// Like the plugin host and app interface: one dialog owner outside Global, and a picker owner inside it.
const Global = createSimpleContext({ name: "Global", init: () => ({ directory: "/home/devbox/project" }) })

export function mountDialogContext(mode: "show" | "push", closing: boolean) {
  const host = document.createElement("div")
  host.dataset.testid = "dialog-context"
  document.body.append(host)

  function Outside() {
    const plugin = useDialog()

    function Inside() {
      const picker = useDialog()

      const choose = () =>
        (closing ? picker : plugin)[mode](() => {
          const global = Global.use()

          return (
            <Dialog>
              <DialogHeader>
                <DialogTitle>Remote project</DialogTitle>
              </DialogHeader>
              <DialogBody>{global.directory}</DialogBody>
            </Dialog>
          )
        })

      return (
        <button
          onClick={() =>
            (closing ? plugin : picker).show(() => (
              <Dialog>
                <DialogHeader>
                  <DialogTitle>SSH connection</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <button
                    onClick={() => {
                      if (closing) plugin.close()
                      queueMicrotask(() => void choose())
                    }}
                  >
                    Finish connection
                  </button>
                </DialogBody>
              </Dialog>
            ))
          }
        >
          Add SSH server
        </button>
      )
    }

    return (
      <Global.provider>
        <Inside />
      </Global.provider>
    )
  }

  return render(
    () => (
      <ErrorBoundary fallback={(error: Error) => <div role="alert">{error.message}</div>}>
        <DialogProvider>
          <Outside />
        </DialogProvider>
      </ErrorBoundary>
    ),
    host,
  )
}
