import type { SessionMessageAssistant, SessionMessageShell } from "@opencode/client/promise"
import { Match } from "effect"
import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { DataProvider } from "../context/data"
import { SessionShellMessage } from "../tools/tool-renderer"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  STORY_TIME,
  executeCodeDocument,
  expandedShellDocument,
  recoveryDocument,
  standaloneShellCompletedDocument,
  standaloneShellRunningDocument,
  terminalFailedDocument,
  terminalPassedDocument,
  terminalRunningDocument,
} from "../storybook/current-session-fixtures"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Work/Terminal",
  id: "current-session-terminal-work",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Common shell states in a real Session turn: an active command, a successful check, a focused failure, and the follow-up correction.",
      },
    },
  },
}

export const RunningTests = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Running tests"
      description="The active shell message keeps its progress treatment and can be opened while running."
      document={terminalRunningDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const RunningAUserCommand = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Running a user command"
      description="A command entered directly in shell mode remains active and streams its captured output."
      document={standaloneShellRunningDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const UserCommandCompleted = {
  render: () => (
    <CurrentSessionTimelineStory
      title="User command completed"
      description="A direct shell command keeps its final output and successful exit status in the transcript."
      document={standaloneShellCompletedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const LiveUserCommand = {
  args: { outcome: "exited", output: true, expanded: true },
  argTypes: { outcome: { control: "select", options: ["exited", "nonzero", "timeout", "killed"] } },
  render: (args: { outcome: "exited" | "nonzero" | "timeout" | "killed"; output: boolean; expanded: boolean }) => {
    const [stats, setStats] = createStore({ reads: 0 })

    const [message, setMessage] = createSignal<SessionMessageShell>({
      id: "msg_shell_live",
      type: "shell",
      shellID: "shell_live",
      command: "printf ready",
      status: "running",
      time: { created: 1 },
    })

    let output = args.output ? "ready\n" : ""

    return (
      <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
        <output aria-label="Output requests">{stats.reads}</output>
        <button type="button" onClick={() => (output += "next line\n")}>
          Update output
        </button>
        <button
          type="button"
          onClick={() => {
            if (args.output) output += "finished\n"
            setMessage((value) => ({
              ...value,
              status: args.outcome === "nonzero" ? "exited" : args.outcome,
              exit: Match.value(args.outcome).pipe(
                Match.when("nonzero", () => 1),
                Match.when("exited", () => 0),
                Match.orElse(() => undefined),
              ),
              output: { output, cursor: output.length, size: output.length, truncated: false },
              time: { created: 1, completed: 2 },
            }))
          }}
        >
          Complete command
        </button>
        <DataProvider
          directory="/workspace"
          data={{ session: [], session_status: {}, session_diff: {} }}
          shellOutput={async (input) => {
            setStats("reads", (value) => value + 1)

            if (message().status !== "running") throw new Error("Shell output unavailable")

            if (input.id !== "shell_live" || input.location?.directory !== "/workspace") {
              throw new Error("Unexpected shell output request")
            }

            return {
              location: {
                directory: "/workspace",
                project: { id: "project_shell", directory: "/workspace", canonical: "/workspace" },
              },
              data: {
                output: output.slice(input.cursor ?? 0),
                cursor: output.length,
                size: output.length,
                truncated: false,
              },
            }
          }}
        >
          <SessionShellMessage message={message()} defaultOpen={args.expanded} />
        </DataProvider>
      </section>
    )
  },
}

const CollapsedShell = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Collapsed completed shell"
      description="A focused shell disclosure responds to the keyboard without scrolling its containing surface."
      document={terminalPassedDocument}
      width="720px"
    />
  ),
}

export const TestsPassed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Tests passed"
      description="A completed focused check shows its command, output, and successful tool state."
      document={terminalPassedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

export const ExpandedShell = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Expanded shell"
      description="The expanded shell separates the command from its output in a full-width card without a detail rail."
      document={expandedShellDocument}
      width="786px"
      shellToolDefaultOpen
    />
  ),
}

export const ExecuteCode = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Execute code"
      description="A Code Mode execution shares the shell treatment: the code and its result split into a two-tone card."
      document={executeCodeDocument}
      width="786px"
      shellToolDefaultOpen
    />
  ),
}

export const ExecuteFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Execute failed"
      description="Failed Code Mode executions open to show the full code and the full error message."
      document={storyDocument([
        storyTool(
          "tool_execute_search",
          "execute",
          "completed",
          { code: 'const found = search({ namespace: "browser", offset: 20, limit: 30 });\nreturn found;\n' },
          { output: "[]" },
        ),
        storyTool(
          "tool_execute_failed_url",
          "execute",
          "completed",
          {
            code: 'const tab = await tools.browser.tabs.open({\n  url: "file:///C:/tmp/opencode/throne-of-glass-luke.html",\n  focus: true\n});\nconst shot = await tools.browser.screenshot({ tabID: tab.id, fullPage: true });\nreturn { tab, shot };\n',
          },
          {
            output:
              "Invalid browser URL. Use an HTTP/HTTPS URL or about:blank without embedded credentials. Paths and file:// URLs are not browser URLs; use browser.preview to show a local file to the user. The connected server must be able to reach the address; localhost refers to that server.",
            metadata: { error: true },
          },
        ),
        {
          type: "reasoning",
          text: "## Serving the page\n\nThe browser needs an HTTP URL, so I will serve the file locally.",
          time: { created: STORY_TIME + 150, completed: STORY_TIME + 1_150 },
        },
        storyTool(
          "tool_execute_serve",
          "shell",
          "completed",
          {
            command:
              "bun -e \"Bun.serve({ port: 4399, fetch() { return new Response(Bun.file('C:/tmp/opencode/throne-of-glass-luke.html'), { headers: { 'content-type': 'text/html' } }) } })\"",
          },
          { output: "", metadata: { exit: 0 } },
        ),
        storyTool(
          "tool_execute_failed_screenshot",
          "execute",
          "completed",
          {
            code: 'const tab = await tools.browser.tabs.open({\n  url: "http://localhost:4399",\n  focus: true\n});\nawait tools.browser.wait({ tabID: tab.id, condition: "load", timeoutMs: 5000 });\nconst shot = await tools.browser.screenshot({ tabID: tab.id, fullPage: true });\nreturn { tab, shot };\n',
          },
          {
            output:
              "[browser.operation_failed] browser.screenshot failed. Screenshot needs a visible tab. Call browser.tabs.focus and keep its desktop window visible.",
            metadata: { error: true },
          },
        ),
        storyTool(
          "tool_execute_list",
          "execute",
          "completed",
          { code: "const list = await tools.browser.tabs.list();\nreturn list;\n" },
          { output: "[]" },
        ),
      ])}
      width="786px"
    />
  ),
}

export const TestFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Test failed"
      description="A normal non-zero test result keeps the command and actionable failure message together."
      document={terminalFailedDocument}
      width="720px"
      shellToolDefaultOpen
    />
  ),
}

function InteractiveCommandStory(props: {
  expanded?: boolean
  streaming?: boolean
  existingGroup?: boolean
  tool?: "shell" | "execute" | "subagent"
}) {
  const initialPhase: "streaming" | "input" | "running" | "completed" = props.streaming ? "streaming" : "completed"

  const [state, setState] = createStore({
    phase: initialPhase,
    started: !props.existingGroup,
    lines: 3,
    sibling: false,
    busy: false,
  })

  const document = createMemo(() => {
    const phase = state.phase

    const options: NonNullable<Parameters<typeof storyTool>[4]> = {
      output:
        phase === "running"
          ? "still running"
          : Array.from({ length: state.lines }, (_, index) => `line ${index + 1}`).join("\n"),
    }

    if (phase === "streaming") options.raw = ""

    const content: SessionMessageAssistant["content"] = [
      ...(props.existingGroup
        ? [storyTool("tool_context_lifecycle", "read", "completed", { filePath: "/workspace/README.md" })]
        : []),
      ...(state.started
        ? [
            storyTool(
              "tool_shell_lifecycle",
              props.tool ?? "shell",
              phase === "input" ? "streaming" : phase,
              phase === "streaming"
                ? {}
                : props.tool === "execute"
                  ? { code: 'console.log("ready")' }
                  : props.tool === "subagent"
                    ? { description: "Inspect lifecycle", agent: "explore", prompt: "Inspect lifecycle" }
                    : { command: "printf ready" },
              options,
            ),
          ]
        : []),
      ...(state.sibling ? [{ type: "text" as const, text: "Sibling content" }] : []),
    ]

    return {
      ...storyDocument(content, state.started && phase !== "completed"),
      status: { type: (state.started && phase !== "completed") || state.busy ? ("busy" as const) : ("idle" as const) },
    }
  })

  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex flex-wrap gap-3">
        {props.existingGroup && (
          <button type="button" onClick={() => setState({ started: true, phase: "streaming" })}>
            Start tool
          </button>
        )}
        <button type="button" onClick={() => setState("phase", "input")}>
          Complete input
        </button>
        <button type="button" onClick={() => setState("phase", "running")}>
          Run command
        </button>
        <button type="button" onClick={() => setState("phase", "completed")}>
          Complete command
        </button>
        <button type="button" onClick={() => setState("lines", 6)}>
          Update output
        </button>
        <button type="button" onClick={() => setState("sibling", true)}>
          Append sibling
        </button>
        <button type="button" onClick={() => setState("busy", true)}>
          Mark session busy
        </button>
        <button type="button" onClick={() => setState("busy", false)}>
          Mark session idle
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} shellToolDefaultOpen={props.expanded} />
      </CurrentSessionProviders>
    </section>
  )
}

export const TerminalCommands = {
  args: { scenario: "command", expanded: false, streaming: false, existingGroup: false, tool: "shell" },
  argTypes: {
    scenario: { control: "select", options: ["command", "collapsed"] },
    tool: { control: "select", options: ["shell", "execute", "subagent"] },
  },
  render: (args: {
    scenario: string
    expanded: boolean
    streaming: boolean
    existingGroup: boolean
    tool: "shell" | "execute" | "subagent"
  }) => (args.scenario === "collapsed" ? CollapsedShell.render() : <InteractiveCommandStory {...args} />),
}

export const FixedAndPassed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Fixed and passed"
      description="The agent reproduces a failure, makes one correction, and reruns the package checks successfully."
      document={recoveryDocument}
      width="860px"
      editToolDefaultOpen
      shellToolDefaultOpen
    />
  ),
}
