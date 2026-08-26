import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, thinkingDocument } from "../storybook/current-session-fixtures"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Tool projection",
  id: "current-session-tool-projection",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Inspectable tool families, error outcomes, grouping, labels, and reactive lifecycle transitions.",
      },
    },
  },
}

function tool(
  id: string,
  name: string,
  status: "streaming" | "running" | "completed" | "error",
  input: Record<string, JsonValue>,
  options: { metadata?: Record<string, JsonValue>; output?: string; error?: string } = {},
): SessionMessageAssistantTool {
  const state =
    status === "streaming"
      ? { status, input: JSON.stringify(input) }
      : status === "running"
        ? { status, input, metadata: { ...options.metadata, ...(options.output ? { output: options.output } : {}) } }
        : status === "error"
          ? {
              status,
              input,
              error: { type: "ToolExecutionError", message: options.error ?? `${name} failed visibly` },
              metadata: options.metadata,
            }
          : {
              status,
              input,
              content: [{ type: "text" as const, text: options.output ?? "Complete" }],
              metadata: options.metadata,
            }
  return {
    type: "tool",
    id,
    name,
    state,
    time: {
      created: STORY_TIME,
      ...(status === "streaming" ? {} : { ran: STORY_TIME + 100 }),
      ...(status === "completed" || status === "error" ? { completed: STORY_TIME + 200 } : {}),
    },
  }
}

function document(content: SessionMessageAssistant["content"], busy = false): SessionDocument {
  return {
    sessionID: CURRENT_SESSION_ID,
    messages: [
      ...thinkingDocument.messages,
      {
        id: "msg_tool_projection_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        content,
        time: { created: STORY_TIME, ...(busy ? {} : { completed: STORY_TIME + 300 }) },
      },
    ],
    status: { type: busy ? "busy" : "idle" },
    diffs: [],
  }
}

function patchFile(file: string, status: "modified" | "added" = "modified") {
  return {
    file,
    status,
    patch:
      status === "added"
        ? "@@ -0,0 +1 @@\n+export const after = true"
        : "@@ -1 +1 @@\n-export const before = true\n+export const after = true",
    additions: 1,
    deletions: status === "added" ? 0 : 1,
  }
}

const questions = { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }

export const EveryToolFamily = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Every admitted tool family"
      description="Context operations group together, visible tools retain their production cards, and hidden todos stay absent."
      document={document([
        tool("tool_family_read", "read", "completed", { path: "src/a.ts" }),
        tool("tool_family_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        tool("tool_family_grep", "grep", "completed", { path: ".", pattern: "value" }),
        tool("tool_family_list", "list", "completed", { path: "src" }),
        tool("tool_family_webfetch", "webfetch", "completed", { url: "https://example.com" }),
        tool("tool_family_websearch", "websearch", "completed", { query: "timeline stability" }),
        tool("tool_family_subagent", "subagent", "completed", {
          description: "Inspect timeline",
          agent: "explore",
          prompt: "Inspect the timeline implementation.",
        }),
        tool("tool_family_shell", "shell", "completed", { command: "printf stable" }, { output: "stable" }),
        tool(
          "tool_family_edit",
          "edit",
          "completed",
          { path: "src/a.ts", oldString: "before", newString: "after" },
          { metadata: { files: [patchFile("src/a.ts")] } },
        ),
        tool("tool_family_write", "write", "completed", { path: "src/new.ts", content: "export const stable = true" }),
        tool(
          "tool_family_patch",
          "patch",
          "completed",
          { patchText: "Update src/b.ts" },
          { metadata: { files: [patchFile("src/b.ts")] } },
        ),
        tool("tool_family_todo", "todowrite", "completed", { todos: [] }),
        tool("tool_family_question", "question", "completed", questions, { metadata: { answers: [["Yes"]] } }),
        tool("tool_family_skill", "skill", "completed", { name: "stability" }),
        tool("tool_family_custom", "custom_mcp_tool", "completed", { target: "timeline" }),
      ])}
      width="860px"
    />
  ),
}

export const EveryToolError = {
  render: () => {
    const names = ["shell", "edit", "write", "patch", "webfetch", "websearch", "subagent", "skill", "mcp_probe"]
    const input = (name: string): Record<string, JsonValue> => {
      if (name === "shell") return { command: "exit 1" }
      if (name === "edit" || name === "write") return { path: "src/error.ts", content: "" }
      if (name === "patch") return { patchText: "Update src/error.ts" }
      if (name === "webfetch") return { url: "https://example.com" }
      if (name === "websearch") return { query: "failure" }
      if (name === "subagent") return { description: "Fail subagent", agent: "explore", prompt: "Inspect." }
      if (name === "skill") return { name: "failure" }
      return { target: "failure" }
    }
    return (
      <CurrentSessionTimelineStory
        title="Every visible tool error"
        description="Ordinary tool failures remain visible, dismissed questions keep their explanation, and todo failures stay hidden."
        document={document([
          ...names.map((name) => tool(`tool_error_${name}`, name, "error", input(name))),
          tool("tool_error_question_dismissed", "question", "error", questions, {
            error: "The user dismissed this question",
          }),
          tool("tool_error_question_transport", "question", "error", questions, { error: "Question transport failed" }),
          tool("tool_error_todo", "todowrite", "error", { todos: [] }, { error: "Hidden todo failure" }),
        ])}
        width="860px"
      />
    )
  },
}

export const SearchProviders = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Web search providers"
      description="Provider-specific search labels remain distinct from the generic fallback."
      document={document([
        tool(
          "tool_search_parallel",
          "websearch",
          "completed",
          { query: "parallel" },
          { metadata: { provider: "parallel" } },
        ),
        tool("tool_search_exa", "websearch", "completed", { query: "exa" }, { metadata: { provider: "exa" } }),
        tool("tool_search_generic", "websearch", "completed", { query: "generic" }),
      ])}
    />
  ),
}

export const ContextLabels = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Context result labels"
      description="Grouped context calls expose singular and plural match counts and the read filename."
      document={document([
        tool("tool_label_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }, { metadata: { count: 1 } }),
        tool("tool_label_grep", "grep", "completed", { path: ".", pattern: "value" }, { metadata: { matches: 12 } }),
        tool("tool_label_read", "read", "completed", { path: "src/a.ts" }),
      ])}
    />
  ),
}

export const SkillLabels = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Loaded skill labels"
      description="Running skills use their identifier while completed skills prefer result metadata."
      document={document([
        tool("tool_skill_id", "skill", "running", { id: "frontend-design" }),
        tool("tool_skill_name", "skill", "completed", { id: "opencode" }, { metadata: { name: "OpenCode" } }),
      ])}
    />
  ),
}

export const ContextBoundaries = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Separated context groups"
      description="Text and shell tools separate singleton and adjacent context operations."
      document={document([
        tool("tool_boundary_read", "read", "completed", { path: "src/a.ts" }),
        { type: "text", text: "Boundary text" },
        tool("tool_boundary_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        tool("tool_boundary_grep", "grep", "completed", { path: ".", pattern: "stable" }),
        tool("tool_boundary_shell", "shell", "completed", { command: "printf done" }, { output: "done" }),
        tool("tool_boundary_list", "list", "completed", { path: "src" }),
      ])}
    />
  ),
}

export const GroupedEdits = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Repeated edits of one file"
      description="Adjacent edits deduplicate the changed filename while preserving its expanded disclosure."
      document={document([
        tool(
          "tool_grouped_edit_first",
          "edit",
          "completed",
          { path: "src/first.ts", oldString: "one", newString: "two" },
          { metadata: { files: [patchFile("src/first.ts")] } },
        ),
        tool(
          "tool_grouped_edit_second",
          "edit",
          "completed",
          { path: "src/first.ts", oldString: "two", newString: "three" },
          { metadata: { files: [patchFile("src/first.ts")] } },
        ),
      ])}
      editToolDefaultOpen
    />
  ),
}

function ShellLifecycleStory(props: { expanded?: boolean; transition?: boolean }) {
  const [state, setState] = createStore({ phase: props.transition ? "streaming" : "completed", revision: 0 })
  const current = createMemo(() => {
    const phase = state.phase as "streaming" | "running" | "completed"
    const command = phase === "streaming" ? "" : "printf ready"
    const content: SessionMessageAssistant["content"] = [
      tool("tool_shell_lifecycle", "shell", phase, command ? { command } : {}, {
        output: phase === "running" ? "still running" : `line ${state.revision + 1}`,
      }),
      ...(state.revision ? [{ type: "text" as const, text: "Sibling content" }] : []),
    ]
    return document(content, phase !== "completed")
  })
  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "running")}>
          Run command
        </button>
        <button type="button" onClick={() => setState("phase", "completed")}>
          Complete command
        </button>
        <button type="button" onClick={() => setState("revision", (value) => value + 1)}>
          Update output
        </button>
      </div>
      <CurrentSessionProviders document={current()}>
        <SessionTimeline document={current()} shellToolDefaultOpen={props.expanded} />
      </CurrentSessionProviders>
    </section>
  )
}

export const StreamingShellLifecycle = { render: () => <ShellLifecycleStory transition /> }
export const CollapsedShellUpdates = { render: () => <ShellLifecycleStory /> }
export const ExpandedShellUpdates = { render: () => <ShellLifecycleStory expanded /> }

function ErrorTransitionStory() {
  const [state, setState] = createStore({ failed: false })
  const current = createMemo(() =>
    document(
      [
        tool(
          "tool_transition_shell",
          "shell",
          state.failed ? "error" : "running",
          { command: "exit 1" },
          {
            error: "Command exited 1",
          },
        ),
        tool("tool_transition_question", "question", state.failed ? "error" : "running", questions, {
          error: "The user dismissed this question",
        }),
      ],
      !state.failed,
    ),
  )
  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <button type="button" onClick={() => setState("failed", true)}>
        Fail running tools
      </button>
      <CurrentSessionProviders document={current()}>
        <SessionTimeline document={current()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const RunningToolErrors = { render: () => <ErrorTransitionStory /> }

function GroupedPatchStory(props: { failure?: boolean }) {
  const [state, setState] = createStore({ phase: "initial" })
  const current = createMemo(() => {
    const first = tool(
      "tool_grouped_patch_first",
      "patch",
      state.phase === "failed" ? "error" : "completed",
      { patchText: "Update src/first.ts" },
      { metadata: { files: [patchFile("src/first.ts")] }, error: "Patch failed visibly" },
    )
    const include = props.failure || state.phase !== "initial"
    const second = tool(
      "tool_grouped_patch_second",
      "patch",
      state.phase === "complete" || state.phase === "failed" ? "completed" : "running",
      { patchText: "Update more files" },
      {
        metadata: {
          files: props.failure
            ? [patchFile("src/surviving.ts")]
            : state.phase === "complete"
              ? [patchFile("src/first.ts"), patchFile("src/second.ts", "added")]
              : [],
        },
      },
    )
    return document(include ? [first, second] : [first], state.phase !== "complete")
  })
  return (
    <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "running")}>
          Append patch
        </button>
        <button type="button" onClick={() => setState("phase", "complete")}>
          Complete patch
        </button>
        <button type="button" onClick={() => setState("phase", "failed")}>
          Fail first patch
        </button>
      </div>
      <CurrentSessionProviders document={current()}>
        <SessionTimeline document={current()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const GroupedPatchUpdates = { render: () => <GroupedPatchStory /> }
export const GroupedPatchFailure = { render: () => <GroupedPatchStory failure /> }
