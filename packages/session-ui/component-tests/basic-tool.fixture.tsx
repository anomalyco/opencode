import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { BasicTool } from "../src/components/basic-tool"
import { CurrentSessionProviders } from "../src/storybook/current-session-story"
import { storyDocument } from "../src/storybook/current-session-scenarios"
import { ToolDisplay } from "../src/tools/tool-renderer"

export { getCachedMarkdown } from "../src/components/markdown-cache"

export function mountGenericTool(input: { message?: string }, output?: string) {
  const host = document.createElement("section")
  host.dataset.testid = "generic-tool-fixture"
  host.style.cssText = "max-width: 720px; padding: 24px"
  document.body.appendChild(host)
  render(
    () => (
      <CurrentSessionProviders document={storyDocument([])}>
        <ToolDisplay
          id="generic_disclosure"
          tool="messageSession"
          status="completed"
          input={input}
          output={output}
          metadata={{}}
        />
      </CurrentSessionProviders>
    ),
    host,
  )
}

export function mountBasicTool() {
  const host = document.createElement("div")
  host.dataset.testid = "basic-tool-fixture"
  document.body.appendChild(host)
  render(() => {
    const [state, setState] = createStore({ label: "Initial title", titles: 0, details: 0 })

    function Title() {
      // Count construction, including JSX created by unused trigger getter reads.
      setState("titles", (value) => value + 1)

      return <span title={state.label}>{state.label}</span>
    }

    function Details() {
      setState("details", (value) => value + 1)

      return <p>Tool details</p>
    }

    return (
      <>
        <output data-testid="trigger-constructions">{state.titles}</output>
        <output data-testid="detail-mounts">{state.details}</output>
        <input
          aria-label="Trigger label"
          value={state.label}
          onInput={(event) => setState("label", event.currentTarget.value)}
        />
        <BasicTool icon="glasses" hasContent trigger={<Title />}>
          <Details />
        </BasicTool>
        <BasicTool icon="glasses" trigger={{ title: state.label, subtitle: "Tool subtitle", args: ["path=src"] }} />
        <BasicTool icon="glasses" trigger={(open) => <span>Function: {open() ? "open" : "closed"}</span>}>
          <p>Function details</p>
        </BasicTool>
      </>
    )
  }, host)
}
