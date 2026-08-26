import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  CURRENT_SESSION_ID,
  STORY_MODEL,
  STORY_TIME,
  inspectAndExplainDocument,
  loadedResourcesDocument,
  subagentDocument,
  thinkingDocument,
  webResearchDocument,
} from "../storybook/current-session-fixtures"
import { storyDocument, storyPatchFile, storyTool } from "../storybook/current-session-scenarios"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Work/Research and agents",
  id: "current-session-research-agents",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Read-only investigation and delegated work using the production context group, web tools, skill notice, and child-Session cards.",
      },
    },
  },
}

export const InspectTheCodebase = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Inspect the codebase"
      description="Glob, grep, and read calls collapse into one context group before the explanation."
      document={inspectAndExplainDocument}
      width="760px"
    />
  ),
}

export const ResearchTheWeb = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Research the web"
      description="A targeted search and source fetch precede a short answer with no code changes."
      document={webResearchDocument}
      width="760px"
    />
  ),
}

export const LoadedResources = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Loaded instruction file and skill"
      description="The assistant reads project instructions, loads specialized guidance, and applies both to its response."
      document={loadedResourcesDocument}
      width="760px"
    />
  ),
}

export const DelegateFocusedTasks = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Delegate focused tasks"
      description="A completed review and an active test task show the two normal child-Session states together."
      document={subagentDocument}
      width="760px"
    />
  ),
}

function CodebaseExplorationStory() {
  const [state, setState] = createStore({ read: false, glob: false })
  const tool = (name: "read" | "glob", completed: boolean) => {
    const input = name === "read" ? { path: "src/a.ts", offset: 0, limit: 120 } : { path: ".", pattern: "**/*.ts" }
    return {
      type: "tool",
      id: `tool_context_${name}`,
      name,
      state: completed
        ? { status: "completed", input, content: [{ type: "text", text: "Complete" }], metadata: {} }
        : { status: "running", input, metadata: {} },
      time: {
        created: STORY_TIME,
        ran: STORY_TIME + 100,
        ...(completed ? { completed: STORY_TIME + 200 } : {}),
      },
    } satisfies SessionMessageAssistantTool
  }
  const document = createMemo(
    () =>
      ({
        sessionID: CURRENT_SESSION_ID,
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_codebase_exploration_assistant",
            type: "assistant",
            agent: "build",
            model: STORY_MODEL,
            content: [tool("read", state.read), tool("glob", state.glob)],
            time: { created: STORY_TIME, ...(state.read && state.glob ? { completed: STORY_TIME + 300 } : {}) },
          } satisfies SessionMessageAssistant,
        ],
        status: { type: state.read && state.glob ? "idle" : "busy" },
        diffs: [],
      }) satisfies SessionDocument,
  )
  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-2">
        <button type="button" onClick={() => setState("read", true)}>
          Complete read
        </button>
        <button type="button" onClick={() => setState("glob", true)}>
          Complete glob
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const ExploreTheCodebase = { render: () => <CodebaseExplorationStory /> }

export const CompareSearchProviders = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compare web search providers"
      description="Search results identify Parallel, Exa, and the generic provider clearly."
      document={storyDocument([
        storyTool(
          "tool_search_parallel",
          "websearch",
          "completed",
          { query: "parallel" },
          { metadata: { provider: "parallel" } },
        ),
        storyTool("tool_search_exa", "websearch", "completed", { query: "exa" }, { metadata: { provider: "exa" } }),
        storyTool("tool_search_generic", "websearch", "completed", { query: "generic" }),
      ])}
    />
  ),
}

export const SearchResultsAndFiles = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Search results and opened files"
      description="Grouped file searches show their match counts and the filename that was inspected."
      document={storyDocument([
        storyTool(
          "tool_label_glob",
          "glob",
          "completed",
          { path: ".", pattern: "**/*.ts" },
          { metadata: { count: 1 } },
        ),
        storyTool(
          "tool_label_grep",
          "grep",
          "completed",
          { path: ".", pattern: "value" },
          { metadata: { matches: 12 } },
        ),
        storyTool("tool_label_read", "read", "completed", { path: "src/a.ts" }),
      ])}
    />
  ),
}

export const LoadingSpecializedSkills = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Loading specialized skills"
      description="Active and completed skills display their identifier or resolved name."
      document={storyDocument([
        storyTool("tool_skill_id", "skill", "running", { id: "frontend-design" }),
        storyTool("tool_skill_name", "skill", "completed", { id: "opencode" }, { metadata: { name: "OpenCode" } }),
      ])}
    />
  ),
}

export const ResearchAcrossSteps = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Research across separate steps"
      description="An explanation and command naturally separate independent file-investigation groups."
      document={storyDocument([
        storyTool("tool_boundary_read", "read", "completed", { path: "src/a.ts" }),
        { type: "text", text: "Boundary text" },
        storyTool("tool_boundary_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        storyTool("tool_boundary_grep", "grep", "completed", { path: ".", pattern: "stable" }),
        storyTool("tool_boundary_shell", "shell", "completed", { command: "printf done" }, { output: "done" }),
        storyTool("tool_boundary_list", "list", "completed", { path: "src" }),
      ])}
    />
  ),
}

const questions = { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }

export const CompleteAgentWorkflow = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Complete agent workflow"
      description="A realistic investigation combines file research, web sources, delegation, commands, edits, and specialist guidance."
      document={storyDocument([
        storyTool("tool_family_read", "read", "completed", { path: "src/a.ts" }),
        storyTool("tool_family_glob", "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        storyTool("tool_family_grep", "grep", "completed", { path: ".", pattern: "value" }),
        storyTool("tool_family_list", "list", "completed", { path: "src" }),
        storyTool("tool_family_webfetch", "webfetch", "completed", { url: "https://example.com" }),
        storyTool("tool_family_websearch", "websearch", "completed", { query: "timeline stability" }),
        storyTool("tool_family_subagent", "subagent", "completed", {
          description: "Inspect timeline",
          agent: "explore",
          prompt: "Inspect the timeline implementation.",
        }),
        storyTool("tool_family_shell", "shell", "completed", { command: "printf stable" }, { output: "stable" }),
        storyTool(
          "tool_family_edit",
          "edit",
          "completed",
          { path: "src/a.ts", oldString: "before", newString: "after" },
          {
            metadata: { files: [storyPatchFile("src/a.ts")] },
          },
        ),
        storyTool("tool_family_write", "write", "completed", {
          path: "src/new.ts",
          content: "export const stable = true",
        }),
        storyTool(
          "tool_family_patch",
          "patch",
          "completed",
          { patchText: "Update src/b.ts" },
          {
            metadata: { files: [storyPatchFile("src/b.ts")] },
          },
        ),
        storyTool("tool_family_todo", "todowrite", "completed", { todos: [] }),
        storyTool("tool_family_question", "question", "completed", questions, { metadata: { answers: [["Yes"]] } }),
        storyTool("tool_family_skill", "skill", "completed", { name: "stability" }),
        storyTool("tool_family_custom", "custom_mcp_tool", "completed", { target: "timeline" }),
      ])}
      width="860px"
    />
  ),
}

export const RecoverFromToolFailures = {
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
        title="Recover from failed work"
        description="Commands, edits, searches, and delegated work explain their failures while dismissed questions stay recognizable."
        document={storyDocument([
          ...names.map((name) => storyTool(`tool_error_${name}`, name, "error", input(name))),
          storyTool("tool_error_question_dismissed", "question", "error", questions, {
            error: "The user dismissed this question",
          }),
          storyTool("tool_error_question_transport", "question", "error", questions, {
            error: "Question transport failed",
          }),
          storyTool("tool_error_todo", "todowrite", "error", { todos: [] }, { error: "Hidden todo failure" }),
        ])}
        width="860px"
      />
    )
  },
}

function FailedCommandAndQuestionStory() {
  const [state, setState] = createStore({ failed: false })
  const document = createMemo(() =>
    storyDocument(
      [
        storyTool(
          "tool_transition_shell",
          "shell",
          state.failed ? "error" : "running",
          { command: "exit 1" },
          {
            error: "Command exited 1",
          },
        ),
        storyTool("tool_transition_question", "question", state.failed ? "error" : "running", questions, {
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
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const FailedCommandAndQuestion = { render: () => <FailedCommandAndQuestionStory /> }

export const DelegatingAnAgent = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Delegating an agent"
      description="The assistant shows its compact delegation status while preparing a focused task."
      document={storyDocument([storyTool("tool_notice_delegation", "subagent", "streaming", {})], true)}
    />
  ),
}

export const StartingBackgroundWork = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Starting background work"
      description="A delegated task keeps its ordinary label until the background request completes."
      document={storyDocument(
        [
          storyTool(
            "tool_notice_background",
            "subagent",
            "running",
            { description: "Inspect code", background: true },
            {
              metadata: { status: "running" },
            },
          ),
        ],
        true,
      )}
    />
  ),
}
