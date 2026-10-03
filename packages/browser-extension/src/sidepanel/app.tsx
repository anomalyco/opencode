import { DialogProvider } from "@opencode/ui/context/dialog"
import { ThemeProvider } from "@opencode/ui/theme/context"
import { Toast } from "@opencode/ui/toast"
import { Show, createMemo } from "solid-js"
import { ServerProvider } from "./connection"
import { createBackground } from "./port"
import { Setup } from "./setup"
import { Shell } from "./shell"

export function App() {
  const background = createBackground()
  // A repeated `ready` with the same URL and password keeps the open connection and its data.
  const info = createMemo(() => background.service(), undefined, {
    equals: (previous, next) =>
      previous?.url === next?.url && previous?.password === next?.password && previous?.source === next?.source,
  })

  return (
    <ThemeProvider>
      <DialogProvider>
        <Show
          when={info()}
          keyed
          fallback={
            <Setup
              state={background.state.service.status === "error" ? background.state.service : { status: "loading" }}
              background={background}
            />
          }
        >
          {(service) => (
            <ServerProvider info={service} background={background}>
              <Shell />
            </ServerProvider>
          )}
        </Show>
        <Toast.Region
          offset={{ right: 12, bottom: 12, left: 12 }}
          mobileOffset={12}
          style={{ "--width": "min(320px, calc(100vw - 24px))" }}
        />
      </DialogProvider>
    </ThemeProvider>
  )
}
