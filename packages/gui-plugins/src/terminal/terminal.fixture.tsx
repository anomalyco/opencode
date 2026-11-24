import { OpenCode } from "@opencode/client/promise"
import { ThemeProvider } from "@opencode/ui/theme/context"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { PluginContext } from "@opencode/plugin/gui/host"
import type { Context, ServerRef } from "@opencode/plugin/gui"
import en from "./i18n/en"
import type { TerminalModel } from "./model"
import { Terminal } from "./terminal"

/**
 * One terminal pane attached to `ptyID` on the server at `url`, with the real ghostty-web and connection. Mounted by
 * `packages/app/component-tests/terminal.spec.ts`, which serves the server with the e2e persistent PTY mock.
 */
export function mountTerminal(input: { url: string; ptyID: string }) {
  const host = document.createElement("div")
  host.dataset.testid = "terminal-fixture"
  host.style.cssText = "position: fixed; inset: 40px auto auto 40px; width: 640px; height: 320px; z-index: 1000"
  document.body.append(host)

  const [failures, setFailures] = createSignal(0)
  const strings: Record<string, string> = en

  const fake = {
    appearance: { font: () => "monospace" },
    keybinds: { matches: () => false },
    system: { openExternal() {} },
    desktop: undefined,
    t: (key: string) => strings[key] ?? key,
  }

  const server = {
    id: input.url,
    name: input.url,
    url: input.url,
    client: OpenCode.make({ baseUrl: input.url }),
    local: true,
    builtin: false,
    compatible: true,
    connected: true,
  }

  const ghostty: TerminalModel["ghostty"] = () =>
    import("ghostty-web").then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))

  // SAFETY: the terminal pane reads only the plugin members implemented above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const plugin = fake as unknown as Context
  // SAFETY: the terminal pane reads only the server's client and url, implemented above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const ref = server as unknown as ServerRef

  return render(
    () => (
      <ThemeProvider>
        <PluginContext.Provider value={plugin}>
          <div data-failures={failures()} style={{ position: "relative", width: "100%", height: "100%" }}>
            <Terminal
              ptyID={input.ptyID}
              server={ref}
              ghostty={ghostty}
              autoFocus
              onFailure={() => setFailures((value) => value + 1)}
            />
          </div>
        </PluginContext.Provider>
      </ThemeProvider>
    ),
    host,
  )
}
