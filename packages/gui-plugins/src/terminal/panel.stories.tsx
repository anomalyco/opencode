import { Button } from "@opencode/ui/button"
import { usePlugin, type ComposerQuote, type PanelFrame, type SessionScreen } from "@opencode/plugin/gui"
import { PanelContext, PluginContext } from "@opencode/plugin/gui/host"
import { createSignal, Show } from "solid-js"
import TerminalPanel from "./panel"
import { terminalPanelFixture, type TerminalScenario } from "./panel.fixture"

function TerminalStory(props: { scenario: TerminalScenario }) {
  const base = usePlugin()
  const fixture = terminalPanelFixture(props.scenario, base.t)
  const terminal = fixture.terminal
  const [quote, setQuote] = createSignal("")
  const [external, setExternal] = createSignal("")

  const plugin: typeof base = Object.create(base, {
    layout: { value: fixture.layout },
    system: { value: { openExternal: setExternal } },
    desktop: { value: undefined },
    // The emulator uses the font in Canvas and FontFaceSet, which need the resolved family.
    appearance: {
      value: { font: () => getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim() },
    },
  })

  const frame: PanelFrame = {
    visible: () => true,
    present: () => true,
    reserve: () => false,
    animate: () => false,
    // The side strip can be empty; the mobile view has the plugin's own tab strip for managing terminals.
    placement: () => (terminal.all().length ? "mobile" : "side"),
    open: fixture.layout.stored,
    sidebar: { opened: () => false, width: () => 0, transition: () => false, resize() {}, toggle() {} },
  }

  // SAFETY: TerminalPanel only reads the composer's quote target and focus action.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const screen = {
    composer: { quotable: () => true, attach: (part: ComposerQuote) => setQuote(part.text), focus() {} },
  } as unknown as SessionScreen

  return (
    <PluginContext.Provider value={plugin}>
      <PanelContext.Provider value={frame}>
        <section class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3">
          <div class="relative h-[350px] overflow-hidden rounded-lg border border-v2-border-border-muted">
            <TerminalPanel
              model={fixture.model}
              session={fixture.session}
              screen={screen}
              tab={() => terminal.active() ?? ""}
            />
            <Show when={terminal.view().type === "ready" && !terminal.all().length}>
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-13-regular">
                <p>No terminals in this session</p>
                <Button size="small" variant="outline" onClick={() => void terminal.new()}>
                  New terminal
                </Button>
              </div>
            </Show>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-12-regular text-v2-text-text-muted">
            <span>Fixture PTY · Input echoes locally.</span>
            <Show when={terminal.view().type === "loading" && props.scenario === "Loading"}>
              <Button size="small" onClick={fixture.finish}>
                Finish loading
              </Button>
            </Show>
            <Show when={terminal.active()}>
              {(id) => (
                <Show
                  when={fixture.attached(id())}
                  fallback={
                    <Button size="small" onClick={fixture.reconnect}>
                      Reconnect
                    </Button>
                  }
                >
                  <Button size="small" onClick={() => fixture.append(id())}>
                    Append output
                  </Button>
                  <Button size="small" onClick={() => fixture.disconnect(id())}>
                    Disconnect
                  </Button>
                </Show>
              )}
            </Show>
          </div>
          <Show when={quote()}>
            <output class="text-12-regular">Quoted: {quote()}</output>
          </Show>
          <Show when={external()}>
            <output class="text-12-regular">System browser request: {external()}</output>
          </Show>
        </section>
      </PanelContext.Provider>
    </PluginContext.Provider>
  )
}

export default {
  title: "App/Plugins/Terminal",
  id: "plugins-terminal",
  args: { scenario: "Running" },
  argTypes: {
    scenario: {
      control: "select",
      options: [
        "Running",
        "Empty",
        "Loading",
        "List failed",
        "Disconnected",
        "Unsupported",
      ] satisfies TerminalScenario[],
    },
  },
  render: (props: { scenario: TerminalScenario }) => (
    <Show when={props.scenario} keyed>
      {(scenario) => <TerminalStory scenario={scenario} />}
    </Show>
  ),
}

export const Running = { args: { scenario: "Running" } }

export const Empty = { args: { scenario: "Empty" } }

export const Loading = { args: { scenario: "Loading" } }

export const ListFailed = { args: { scenario: "List failed" } }

export const Disconnected = { args: { scenario: "Disconnected" } }

export const Unsupported = { args: { scenario: "Unsupported" } }
