import { createMemo, createSignal } from "solid-js"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Work/Tool headers",
  id: "current-session-tool-headers",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

export const SharedHeaders = {
  args: { phase: "completed", pathKnown: true, longPath: false },
  argTypes: { phase: { control: "select", options: ["streaming", "running", "completed"] } },
  render: (args: { phase: "streaming" | "running" | "completed"; pathKnown: boolean; longPath: boolean }) => {
    const [phase, setPhase] = createSignal(args.phase)
    const [known, setKnown] = createSignal(args.pathKnown)
    const path = (name: string) =>
      args.longPath
        ? `src/components/session/timeline/tools/deeply/nested/directory/with/a/long/path/${"long-filename-".repeat(8)}${name}.ts`
        : `src/components/${name}.ts`
    const document = createMemo(() =>
      storyDocument(
        [
          storyTool("tool_header_read", "read", phase(), { path: path("read"), offset: 12, limit: 40 }),
          storyTool(
            "tool_header_grep",
            "grep",
            phase(),
            { path: "src/components", pattern: "header", include: "*.tsx" },
            { metadata: { matches: 3 } },
          ),
          storyTool("tool_header_shell", "shell", phase(), { command: "printf checked" }, { output: "checked" }),
          storyTool(
            "tool_header_execute",
            "execute",
            phase(),
            { code: 'console.log("checked")' },
            { output: "checked" },
          ),
          storyTool("tool_header_webfetch", "webfetch", phase(), { url: "https://example.com/docs" }),
          storyTool("tool_header_edit", "edit", phase(), {
            ...(known() ? { path: path("edit") } : {}),
            oldString: "export const before = true\n",
            newString: "export const after = true\n",
          }),
          storyTool("tool_header_write", "write", phase(), {
            ...(known() ? { path: path("write") } : {}),
            content: "export const written = true\n",
          }),
        ],
        phase() !== "completed",
      ),
    )
    return (
      <section class="mx-auto flex w-full max-w-[840px] flex-col gap-4 p-6">
        <div class="flex flex-wrap gap-3">
          <button type="button" onClick={() => setKnown(true)}>
            Provide paths
          </button>
          <button type="button" onClick={() => setPhase("running")}>
            Run tools
          </button>
          <button type="button" onClick={() => setPhase("completed")}>
            Complete tools
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase(args.phase)
              setKnown(args.pathKnown)
            }}
          >
            Reset
          </button>
        </div>
        <CurrentSessionProviders document={document()}>
          <SessionTimeline document={document()} />
        </CurrentSessionProviders>
      </section>
    )
  },
}
