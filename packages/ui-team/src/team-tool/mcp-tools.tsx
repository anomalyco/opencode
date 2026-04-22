import { For, Show, createMemo } from "solid-js"
import type { ToolComponent } from "../components/message-part"
import { presenter, type ToolPresenterDef } from "./tool-presenter"
import { Markdown } from "../../../ui/src/components/markdown"

type Input = Record<string, unknown>

function text(value: unknown) {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (!trimmed) return
  return trimmed
}

function values(input: Input, keys: string[]) {
  return keys.flatMap((key) => {
    const value = input[key]
    if (typeof value === "string" && value) return [`${key}=${value}`]
    if (typeof value === "number") return [`${key}=${value}`]
    if (typeof value === "boolean") return [`${key}=${value}`]
    if (Array.isArray(value) && value.length > 0) {
      return [`${key}=${value.filter((item) => typeof item === "string").join(", ")}`]
    }
    return []
  })
}

function links(output?: string) {
  if (!output) return [] as string[]
  const seen = new Set<string>()
  return [...output.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)]
    .map((item) => item[0].replace(/[),.;:!?]+$/g, ""))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function bullets(output?: string) {
  if (!output) return [] as string[]
  return output
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => /^(-|\*|\d+\.)\s+/.test(item))
    .map((item) => item.replace(/^(-|\*|\d+\.)\s+/, ""))
}

function headline(output?: string) {
  if (!output) return
  return output
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("```"))
}

function stories(input: Input) {
  if (!Array.isArray(input.stories)) return [] as string[]
  return input.stories.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const name = text(row.exportName)
    const path = text(row.absoluteStoryPath)
    if (name && path) return [`${name} · ${path.split("/").at(-1)}`]
    if (name) return [name]
    if (path) return [path]
    return []
  })
}

function McpRich(props: { input: Input; output?: string }) {
  const line = createMemo(() => headline(props.output))
  const urls = createMemo(() => links(props.output))
  const notes = createMemo(() => bullets(props.output).slice(0, 6))
  const previews = createMemo(() => stories(props.input).slice(0, 4))

  return (
    <div data-component="team-tool-body">
      <Show when={previews().length > 0}>
        <div data-slot="team-tool-pills">
          <For each={previews()}>{(item: string) => <span data-slot="team-tool-pill">{item}</span>}</For>
        </div>
      </Show>
      <Show when={line() && notes().length === 0}>
        <div data-slot="team-tool-summary">{line()}</div>
      </Show>
      <Show when={notes().length > 0}>
        <div data-slot="team-tool-stack">
          <For each={notes()}>{(item: string) => <span data-slot="team-tool-line">{item}</span>}</For>
        </div>
      </Show>
      <Show when={urls().length > 0}>
        <div data-slot="team-tool-links">
          <For each={urls()}>
            {(item: string) => (
              <a data-slot="team-tool-link" href={item} target="_blank" rel="noopener noreferrer">
                {item}
              </a>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.output}>
        <div data-component="tool-output" data-scrollable>
          <Markdown text={props.output!} />
        </div>
      </Show>
    </div>
  )
}

const defs: ToolPresenterDef[] = [
  {
    name: "gh_grep_searchGitHub",
    icon: "mcp",
    title: () => "GitHub Search",
    subtitle: (input) => text(input.query) ?? "",
    args: (input) => values(input, ["repo", "path", "language"]),
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "context7_resolve-library-id",
    icon: "mcp",
    title: () => "Resolve Library",
    subtitle: (input) => text(input.libraryName) ?? text(input.query) ?? "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "context7_query-docs",
    icon: "mcp",
    title: () => "Query Docs",
    subtitle: (input) => text(input.query) ?? "",
    args: (input) => values(input, ["libraryId"]),
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "microsoft-learn_microsoft_docs_search",
    icon: "mcp",
    title: () => "Microsoft Docs Search",
    subtitle: (input) => text(input.query) ?? "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "microsoft-learn_microsoft_code_sample_search",
    icon: "mcp",
    title: () => "Microsoft Samples",
    subtitle: (input) => text(input.query) ?? "",
    args: (input) => values(input, ["language"]),
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "microsoft-learn_microsoft_docs_fetch",
    icon: "mcp",
    title: () => "Microsoft Docs",
    subtitle: (input) => text(input.url) ?? "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_list-all-documentation",
    icon: "mcp",
    title: () => "Storybook Docs",
    subtitle: () => "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_get-documentation",
    icon: "mcp",
    title: () => "Storybook Doc",
    subtitle: (input) => text(input.id) ?? "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_preview-stories",
    icon: "mcp",
    title: () => "Storybook Preview",
    subtitle: (input) => (Array.isArray(input.stories) ? `${input.stories.length} stories` : ""),
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_get-ui-building-instructions",
    icon: "mcp",
    title: () => "UI Instructions",
    subtitle: () => "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_run-story-tests",
    icon: "mcp",
    title: () => "Storybook Tests",
    subtitle: (input) => (Array.isArray(input.stories) ? `${input.stories.length} stories` : ""),
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
  {
    name: "storybookmcp_get-storybook-story-instructions",
    icon: "mcp",
    title: () => "Story Instructions",
    subtitle: () => "",
    body: "custom",
    renderBody: ({ input, output }) => <McpRich input={input} output={output} />,
  },
]

export const mcpTools: Array<{ name: string; render: ToolComponent }> = defs.map(presenter)
