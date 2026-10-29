import { ThemeProvider } from "@opencode/ui/theme/context"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { ComposerQuoteAnchor, Context, ServerRef } from "@opencode/plugin/gui"
import { PluginContext } from "@opencode/plugin/gui/host"
import { Terminal } from "./terminal"
import { TerminalQuote } from "./quote"

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

  const plugin = fixturePlugin()

  // SAFETY: the terminal reads only these server members; the PTY token never resolves, so it never connects.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const server = {
    id: "fixture",
    name: "fixture",
    url: "http://127.0.0.1:1",
    client: { pty: { connect: { token: () => new Promise(() => {}) } } },
  } as unknown as ServerRef

  const dispose = render(
    () => (
      <ThemeProvider>
        <PluginContext.Provider value={plugin}>
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
        </PluginContext.Provider>
      </ThemeProvider>
    ),
    surface,
  )

  return () => {
    dispose()
    host.remove()
  }
}

/** Keeps a memoized quote consumer alive after its terminal source's owner is disposed. */
export async function mountTerminalQuote() {
  const mod = await import("ghostty-web")
  const ghostty = await mod.Ghostty.load()
  const host = document.createElement("div")
  host.dataset.testid = "terminal-quote-fixture"
  host.style.cssText =
    "position:fixed;inset:16px auto auto 16px;z-index:40;background:white;color:black;width:640px;height:440px;padding:16px;display:flex;flex-direction:column;gap:8px"
  document.body.append(host)

  const plugin = fixturePlugin()

  const dispose = render(() => {
    const [state, setState] = createStore<{
      mounted: boolean
      anchor: ComposerQuoteAnchor | undefined
      text: string
    }>({
      mounted: true,
      anchor: undefined,
      text: "",
    })

    // Do not read `mounted`: the source must invalidate this retained memo itself during disposal.
    const source = createMemo(() => state.anchor?.({ width: 320, height: 120 }))

    const Source = () => {
      const [ready, setReady] = createSignal(false)
      const container = document.createElement("div")
      container.dataset.testid = "terminal-quote-source"
      container.style.cssText = "position:relative;width:600px;height:240px"
      const term = new mod.Terminal({ ghostty, cols: 60, rows: 10 })
      onMount(() => {
        term.open(container)
        term.write("Retained terminal output", () => setReady(true))
      })
      onCleanup(() => term.dispose())

      return (
        <>
          <button
            disabled={!ready()}
            on:click={(event) => {
              event.stopPropagation()
              term.select(0, 0, 24)
            }}
          >
            Select output
          </button>
          {container}
          <Show when={ready()}>
            <TerminalQuote
              term={term}
              container={container}
              written={1}
              target={{
                available: () => true,
                add: (text, anchor) => setState({ text, anchor }),
              }}
            />
          </Show>
        </>
      )
    }

    return (
      <ThemeProvider>
        <PluginContext.Provider value={plugin}>
          <button onClick={() => setState("mounted", false)}>Dispose source</button>
          <output aria-label="Quote placement">{source() ? "Source" : "Tile"}</output>
          <output aria-label="Quoted output">{state.text}</output>
          <Show when={state.mounted}>
            <Source />
          </Show>
        </PluginContext.Provider>
      </ThemeProvider>
    )
  }, host)

  return () => {
    dispose()
    host.remove()
  }
}

function fixturePlugin() {
  // SAFETY: the terminal and quote toolbar read only these plugin members while they mount and focus.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return {
    t: (key: string) => key,
    appearance: { font: () => "monospace" },
    keybinds: { matches: () => false },
    system: { openExternal() {} },
  } as unknown as Context
}
