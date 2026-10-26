import { ThemeProvider } from "@opencode/ui/theme/context"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { ExtensionContext, type Context, type ServerRef } from "../sdk"
import { Terminal } from "./terminal"

/**
 * Mounts the real terminal beside a focused composer field, as the side panel does when the user opens a terminal while
 * typing. The PTY connection never resolves, so only the mount and focus lifecycle runs.
 */
export function mountTerminalFocus(input: { autoFocus: boolean }) {
  const host = document.createElement("div")
  host.dataset.testid = "terminal-focus-fixture"
  host.style.cssText = "display:flex;flex-direction:column;gap:8px;width:640px;height:360px"
  document.body.append(host)

  const composer = document.createElement("textarea")
  composer.setAttribute("aria-label", "Composer")
  host.append(composer)
  composer.focus()

  const surface = document.createElement("div")
  surface.style.cssText = "position:relative;flex:1"
  host.append(surface)

  // As the panel's focus request does, consuming the request turns autoFocus off.
  const [requested, setRequested] = createSignal(input.autoFocus)

  // SAFETY: the terminal reads only these extension members while it mounts and focuses.
  const extension = {
    t: (key: string) => key,
    appearance: { font: () => "monospace" },
    keybinds: { matches: () => false },
    system: { openExternal() {} },
  } as unknown as Context

  // SAFETY: the terminal reads only these server members; the PTY token never resolves, so it never connects.
  const server = {
    id: "fixture",
    name: "fixture",
    url: "http://127.0.0.1:1",
    client: { pty: { connect: { token: () => new Promise(() => {}) } } },
  } as unknown as ServerRef

  const dispose = render(
    () => (
      <ThemeProvider>
        <ExtensionContext.Provider value={extension}>
          <Terminal
            pty={{ id: "pty_fixture", title: "Terminal", titleNumber: 1 }}
            server={server}
            directory="/fixture"
            ghostty={() =>
              import("ghostty-web").then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
            }
            autoFocus={requested()}
            onAutoFocus={() => setRequested(false)}
          />
        </ExtensionContext.Provider>
      </ThemeProvider>
    ),
    surface,
  )

  return () => {
    dispose()
    host.remove()
  }
}
