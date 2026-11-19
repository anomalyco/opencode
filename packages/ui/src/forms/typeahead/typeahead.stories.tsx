import { createSignal, onMount, Show } from "solid-js"
import { Typeahead } from "./typeahead"

const projects = [
  "Desktop app",
  "Desktop snapshots",
  "Documentation",
  "Release notes",
  "Release tools",
  "Story browser",
]

const matches = (project: string, query: string) => project.toLowerCase().includes(query.toLowerCase())

type Source = "preloaded" | "load on open" | "fail once"

type Args = { source: Source; query: string; debounceMs: number; latencyMs: number }

function Search(props: Args) {
  const [selected, setSelected] = createSignal("")

  const initial = props.source === "preloaded" ? { items: projects.slice(0, 3) } : undefined

  let shouldFail = props.source === "fail once"

  let host!: HTMLDivElement

  const source = (query: string, signal: AbortSignal) =>
    new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (shouldFail) {
          shouldFail = false
          reject(new Error("Project index unavailable"))

          return
        }

        resolve(projects.filter((project) => matches(project, query)))
      }, props.latencyMs)

      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(signal.reason)
        },
        { once: true },
      )
    })

  // Typeahead owns its input. Seed a preset through the same input event as typing, including debounce and stale rows.
  onMount(() => {
    if (!props.query) return
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')

    if (!input) return
    input.value = props.query
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })

  return (
    <div class="grid w-80 max-w-full gap-2">
      <div ref={host} class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01">
        <Typeahead
          source={source}
          initial={initial}
          match={matches}
          key={(project) => project}
          delay={props.debounceMs}
          placeholder="Search projects"
          emptyLabel="No matching projects"
          retryLabel="Couldn't load projects. Retry"
          selected={selected()}
          onSelect={setSelected}
        >
          {(project) => <span>{project}</span>}
        </Typeahead>
      </div>
      <output class="text-xs text-v2-text-text-muted">
        {selected() ? `Selected: ${selected()}` : "Use the arrow keys and Enter to choose a project."}
      </output>
    </div>
  )
}

export default {
  title: "UI/Typeahead",
  id: "ui-typeahead",
  args: { source: "preloaded", query: "", debounceMs: 250, latencyMs: 400 } satisfies Args,
  argTypes: {
    source: { control: "select", options: ["preloaded", "load on open", "fail once"] },
    debounceMs: { control: { type: "range", min: 0, max: 2000, step: 50 } },
    latencyMs: { control: { type: "range", min: 0, max: 5000, step: 100 } },
  },
  render: (args: Args) => (
    // A new fixture starts with its own empty request cache. Tuning the timings leaves the current query intact.
    <Show when={{ source: args.source, query: args.query }} keyed>
      {(opening) => <Search {...args} {...opening} />}
    </Show>
  ),
}

export const Preloaded = {}

export const Loading = { args: { source: "load on open", latencyMs: 2000 } }

export const DelayedTyping = { args: { query: "desk", debounceMs: 1000, latencyMs: 1500 } }

export const StaleResults = { args: { query: "release", latencyMs: 3000 } }

export const Empty = { args: { query: "no matches" } }

export const FailAndRetry = { args: { source: "fail once" } }
