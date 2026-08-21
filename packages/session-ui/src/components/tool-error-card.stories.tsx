import { For } from "solid-js"
import { ToolErrorCard } from "./tool-error-card"

const docs = `### Overview
Tool call failure summary styled like a tool trigger.

### API
- Required: \`tool\` (tool id, e.g. patch, shell)
- Required: \`error\` (error string)

### Behavior
- Collapsible; click header to expand/collapse.
`

const samples = [
  {
    tool: "patch",
    error:
      "patch verification failed: Failed to find expected lines in packages/session-ui/src/timeline/session-timeline.tsx",
  },
  {
    tool: "shell",
    error: "shell Command failed: exit code 1: bun test src/timeline",
  },
  {
    tool: "read",
    error:
      "read File not found: /Users/davidhill/Documents/Local/opencode/packages/ui/src/components/does-not-exist.tsx",
  },
  {
    tool: "glob",
    error: "glob Pattern error: Invalid glob pattern: **/*[",
  },
  {
    tool: "grep",
    error: "grep Regex error: Invalid regular expression: (unterminated group",
  },
  {
    tool: "webfetch",
    error: "webfetch Request failed: 502 Bad Gateway",
  },
  {
    tool: "websearch",
    error: "websearch Rate limited: Please try again in 30 seconds",
  },
  {
    tool: "question",
    error: "question Dismissed: user dismissed this question",
  },
]

export default {
  title: "OpenCode/Tools/Failure details",
  id: "components-tool-error-card",
  component: ToolErrorCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    tool: "patch",
    error: samples[0].error,
  },
  argTypes: {
    tool: {
      control: "select",
      options: ["patch", "shell", "read", "glob", "grep", "webfetch", "websearch", "question"],
    },
    error: {
      control: "text",
    },
  },
  render: (props: { tool: string; error: string }) => {
    return <ToolErrorCard tool={props.tool} error={props.error} />
  },
}

export const All = {
  render: () => {
    return (
      <div style="display: flex; flex-direction: column; gap: 12px; max-width: 720px;">
        <For each={samples}>{(item) => <ToolErrorCard tool={item.tool} error={item.error} />}</For>
      </div>
    )
  },
}
