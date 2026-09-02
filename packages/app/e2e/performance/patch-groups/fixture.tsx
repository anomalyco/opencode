/// <reference types="vite/client" />

import { render } from "solid-js/web"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { CurrentSessionProviders } from "../../../../session-ui/src/storybook/current-session-story"
import { emptySessionDocument } from "../../../../session-ui/src/storybook/current-session-fixtures"
import { CurrentFileToolGroup, ToolDisplay } from "../../../../session-ui/src/tools/tool-renderer"
import { patchFileGroups } from "../../../../session-ui/src/components/apply-patch-file"
import type { SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { createTwoFilesPatch, diffLines } from "diff"
import edit from "../../../../core/src/tool/plugin/edit.ts?raw"
import patch from "../../../../core/src/tool/plugin/patch.ts?raw"
import read from "../../../../core/src/tool/plugin/read.ts?raw"
import shell from "../../../../core/src/tool/plugin/shell.ts?raw"
import "../../../src/index.css"

const scenario = new URLSearchParams(location.search).get("scenario") ?? "complete"
const sources = [edit, patch, read, shell].map((text) => text.replaceAll("\r\n", "\n"))
const names = ["edit", "patch", "read", "shell"]
const changed = (text: string) => text.replaceAll(/\bcontext\b/g, "invocation")
const entry = (index: number, before: string, after: string) => ({
  file: `src/tool/plugin/${names[index]}.ts`,
  patch: createTwoFilesPatch(names[index], names[index], before, after, "", "", {
    context: scenario === "partial" ? 3 : Infinity,
  }),
  ...diffLines(before, after).reduce(
    (counts, item) => ({
      additions: counts.additions + (item.added ? item.count : 0),
      deletions: counts.deletions + (item.removed ? item.count : 0),
    }),
    { additions: 0, deletions: 0 },
  ),
  status: "modified" as const,
})
const files =
  scenario === "multi"
    ? sources.map((text, index) => entry(index, text, changed(text)))
    : [
        entry(0, sources[0], changed(sources[0])),
        ...(scenario === "chained"
          ? [entry(0, changed(sources[0]), changed(sources[0]).replaceAll(/\binput\b/g, "parameters"))]
          : []),
      ]
const tools: SessionMessageAssistantTool[] = files.map((file, index) => ({
  id: `fixture-edit-${index}`,
  type: "tool",
  name: "edit",
  state: {
    status: "completed",
    input: { path: file.file, oldString: "context", newString: "invocation", replaceAll: true },
    metadata: { files: [file] },
    content: [{ type: "text", text: `Edited ${file.file}` }],
  },
  time: { created: 1, ran: 2, completed: 3 },
}))

declare global {
  interface Window {
    patchBenchmark: {
      payloadBytes: number
      sourceBytes: number
      files: number
      tools: number
      grouping: (expanded: boolean) => { ms: number; groups: number; views: number }
    }
  }
}
window.patchBenchmark = {
  payloadBytes: new TextEncoder().encode(JSON.stringify(tools)).length,
  sourceBytes: new TextEncoder().encode(sources.slice(0, scenario === "multi" ? 4 : 1).join("")).length,
  files: new Set(files.map((file) => file.file)).size,
  tools: tools.length,
  grouping(expanded) {
    const start = performance.now()
    const groups = patchFileGroups(files)
    const views = expanded ? groups.reduce((count, file) => count + file.views.length, 0) : 0
    return { ms: performance.now() - start, groups: groups.length, views }
  },
}

function Fixture() {
  const [state, setState] = createStore({ mounted: false, duration: 0, rendered: 0 })
  let start = 0
  return (
    <ThemeProvider>
      <section style={{ margin: "24px auto", "max-width": "960px" }}>
        <button
          onClick={() => {
            start = performance.now()
            setState("mounted", true)
            document.querySelector("[data-component=apply-patch-tool]")!.getBoundingClientRect()
            setState("duration", performance.now() - start)
          }}
        >
          Mount tools
        </button>
        <button
          onClick={() => {
            setState({ mounted: false, rendered: 0 })
          }}
        >
          Unmount tools
        </button>
        <output data-testid="mount-ms">{state.duration}</output>
        <output data-testid="rendered">{state.rendered}</output>
        <div
          on:click={{
            capture: true,
            handleEvent() {
              start = performance.now()
            },
          }}
        >
          <Show when={state.mounted}>
            <CurrentSessionProviders document={emptySessionDocument}>
              <Show
                when={scenario === "direct"}
                fallback={
                  <CurrentFileToolGroup
                    tools={tools}
                    onSizeChange={() => setState("rendered", performance.now() - start)}
                  />
                }
              >
                <ToolDisplay
                  id="fixture-patch"
                  tool="patch"
                  input={{}}
                  metadata={{ files }}
                  status="completed"
                  onContentRendered={() => setState("rendered", performance.now() - start)}
                />
              </Show>
            </CurrentSessionProviders>
          </Show>
        </div>
      </section>
    </ThemeProvider>
  )
}
render(() => <Fixture />, document.getElementById("root")!)
