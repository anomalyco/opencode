import { createTwoFilesPatch } from "diff"
import { createEffect, createMemo, createSignal, untrack } from "solid-js"
import { Dynamic } from "solid-js/web"
import { createStore } from "solid-js/store"
import type { TurnDiffSource, TurnDiffState } from "../context/data"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  editThenTestDocument,
  fileChangeLoadingDocument,
  fileChangeRunningDocument,
  multiFilePatchDocument,
  writeFileDocument,
} from "../storybook/current-session-fixtures"
import { storyDocument, storyPatchFile, storyTool } from "../storybook/current-session-scenarios"
import type { SessionDocument } from "../document"
import { SessionTimeline } from "./session-timeline"
import { ToolDisplay } from "../tools/tool-renderer"

export default {
  title: "OpenCode/Work/File changes",
  id: "current-session-file-changes",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production file-change messages using current tool states and deterministic diff content. Loading and running states show the disclosure header; completed edits and patches render the real diff viewer.",
      },
    },
  },
}

export const PreparingAnEdit = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Preparing an edit"
      description="Tool input is still streaming, so the file change presents its loading state."
      document={fileChangeLoadingDocument}
      width="720px"
    />
  ),
}

export const ApplyingAnEdit = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Applying an edit"
      description="The file is known and the edit is running, but no completed diff is available yet."
      document={fileChangeRunningDocument}
      width="720px"
    />
  ),
}

export const EditedAndVerified = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Edited and verified"
      description="A completed one-file edit shows its real diff before the focused test and result."
      document={editThenTestDocument}
      width="860px"
      editToolDefaultOpen
      shellToolDefaultOpen
    />
  ),
}

export const PatchedTwoFiles = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Patched two files"
      description="A common implementation step updates one component and adds its focused test."
      document={multiFilePatchDocument}
      width="860px"
      editToolDefaultOpen
    />
  ),
}

const RepeatedEdits = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Repeated edits of one file"
      description="Consecutive improvements to the same source file remain together in one expanded change."
      document={storyDocument([
        storyTool(
          "tool_grouped_edit_first",
          "edit",
          "completed",
          { path: "src/first.ts", oldString: "one", newString: "two" },
          {
            metadata: { files: [storyPatchFile("src/first.ts")] },
          },
        ),
        storyTool(
          "tool_grouped_edit_second",
          "edit",
          "completed",
          { path: "src/first.ts", oldString: "two", newString: "three" },
          {
            metadata: { files: [storyPatchFile("src/first.ts")] },
          },
        ),
      ])}
      editToolDefaultOpen
    />
  ),
}

function EditSiblingUpdateStory() {
  const [state, setState] = createStore({ sibling: false })

  const document = createMemo(() => ({
    ...editThenTestDocument,
    status: { type: "busy" as const },
    messages: editThenTestDocument.messages
      .filter((message) => message.id === "msg_user_edit" || message.id === "msg_assistant_edit")
      .map((message) => {
        if (message.type !== "assistant") return message

        return {
          ...message,
          time: { created: message.time.created },
          content: [
            ...message.content,
            ...(state.sibling ? [{ type: "text" as const, text: "Streaming added a later assistant text part." }] : []),
          ],
        }
      }),
  }))

  return (
    <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
      <button type="button" onClick={() => setState("sibling", true)}>
        Stream sibling content
      </button>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} editToolDefaultOpen />
      </CurrentSessionProviders>
    </section>
  )
}

const EditWithStreamedSibling = { render: () => <EditSiblingUpdateStory /> }

const ThreeFilePatch = {
  render: () => {
    const source = (changed: boolean) =>
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join("")

    const files = [
      { file: "src/a.ts", status: "modified" },
      { file: "src/b.ts", status: "added" },
      { file: "src/old.ts", status: "deleted" },
    ].map(({ file, status }) => ({
      file,
      status,
      patch: createTwoFilesPatch(
        `a/${file}`,
        `b/${file}`,
        status === "added" ? "" : source(false),
        status === "deleted" ? "" : source(true),
      ),
      additions: status === "deleted" ? 0 : 4,
      deletions: status === "added" ? 0 : 3,
    }))

    return (
      <CurrentSessionTimelineStory
        title="Update, create, and remove files"
        description="Each changed file can be opened and closed independently."
        document={storyDocument([
          storyTool(
            "prt_nested_patch",
            "patch",
            "completed",
            { patchText: "Update three files" },
            { metadata: { files } },
          ),
        ])}
        editToolDefaultOpen
      />
    )
  },
}

const WrittenSource = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Create a source file"
      description="A completed TypeScript write renders its generated source."
      document={storyDocument([
        storyTool("prt_file_projection_write", "write", "completed", {
          path: "src/write.ts",
          content: "export const written = true\n",
        }),
      ])}
      editToolDefaultOpen
    />
  ),
}

// A finished turn: the step records which files changed, and the idle marker ends the turn.
function finishedTurnDocument(files: { file: string; before: string; after: string }[]): SessionDocument {
  const document = storyDocument([
    storyTool("tool_turn_shell", "shell", "completed", { command: "bun run format" }, { output: "Formatted" }),
  ])

  const step = document.messages.at(-1)

  if (step?.type !== "assistant") throw new Error("Expected the story document to end with a step")

  return {
    ...document,
    messages: [
      ...document.messages.slice(0, -1),
      { ...step, snapshot: { files: files.map((item) => item.file) } },
      { id: "msg_turn_idle", type: "idle", outcome: "succeeded", time: { created: step.time.created + 400 } },
    ],
    diffs: files.map((item) => {
      const lines = (text: string) => (text ? text.split("\n").length - 1 : 0)
      const changes = createTwoFilesPatch(item.file, item.file, item.before, item.after)

      return {
        file: item.file,
        patch: changes,
        additions: item.before ? (item.after ? 1 : 0) : lines(item.after),
        deletions: item.after ? (item.before ? 1 : 0) : lines(item.before),
        status: !item.before ? "added" : !item.after ? "deleted" : "modified",
      }
    }),
  }
}

export const TurnChangeSummary = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Turn change summary"
      description="Once the turn ends, every file it changed is summarized below it, including changes made by shell commands."
      document={finishedTurnDocument([
        {
          file: "packages/app/src/session/timeline/message-timeline.tsx",
          before: "export const before = true\n",
          after: "export const after = true\n",
        },
        { file: "packages/app/src/session/turn-summary.ts", before: "", after: "export const summary = []\n" },
        { file: "packages/app/src/session/legacy-summary.ts", before: "export const legacy = []\n", after: "" },
      ])}
      width="860px"
      turnDiffs
    />
  ),
}

export const TurnChangeSummaryOverflow = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Turn change summary with many files"
      description="Past five files, the rest of the turn's changes wait behind Show all."
      document={finishedTurnDocument(
        Array.from({ length: 14 }, (_, index) => ({
          file: `src/modules/module-${index + 1}.ts`,
          before: `export const value = ${index}\n`,
          after: `export const value = ${index + 1}\n`,
        })),
      )}
      width="860px"
      turnDiffs
    />
  ),
}

// The first load fails, as a dropped connection or a stalled response would, and a retry loads the diffs.
function retryableTurnDiff(document: SessionDocument): TurnDiffSource {
  const [state, setState] = createSignal<TurnDiffState>({ status: "loading" })

  return {
    state: () => state(),
    load: () => {
      const current = untrack(state)

      if (current.status === "loading") return setState({ status: "failed" })

      if (current.status === "failed") setState({ status: "ready", diffs: document.diffs })
    },
  }
}

export const TurnChangeSummaryFailed = {
  render: () => {
    const document = finishedTurnDocument([
      { file: "src/session/reconnect.ts", before: "export const delay = 1\n", after: "export const delay = 2\n" },
      { file: "src/session/reconnect.test.ts", before: "", after: "test('reconnects', () => {})\n" },
    ])

    // Built once: Solid reads a call written in a prop again on every access.
    const turnDiff = retryableTurnDiff(document)

    return (
      <CurrentSessionTimelineStory
        title="Turn change summary that failed to load"
        description="The turn's files stay listed without counts, and Retry loads them again."
        document={document}
        width="860px"
        turnDiffs
        turnDiff={turnDiff}
      />
    )
  },
}

const fileScenarios = {
  repeated: RepeatedEdits,
  streaming: EditWithStreamedSibling,
  patch: ThreeFilePatch,
  write: WrittenSource,
}

export const AppendingToolCalls = {
  args: { calls: 0 },
  argTypes: { calls: { control: { type: "range", min: 0, max: 12, step: 1 } } },
  render: (args: { calls: number }) => {
    const [state, setState] = createStore({ calls: args.calls })
    createEffect(() => setState("calls", args.calls))

    const files = ["src/a.ts", "src/b.ts"].map((file) => ({
      ...storyPatchFile(file),
      patch: createTwoFilesPatch(file, file, "export const before = true\n", "export const after = true\n"),
    }))

    const document = createMemo(() =>
      storyDocument([
        storyTool("tool_shell_existing", "shell", "completed", { command: "printf checked" }, { output: "checked" }),
        storyTool(
          "tool_patch_existing",
          "patch",
          "completed",
          { patchText: "Update two files" },
          {
            metadata: { files },
          },
        ),
        ...Array.from({ length: state.calls }, (_, index) =>
          storyTool(
            `tool_patch_next_${index}`,
            "patch",
            "completed",
            { patchText: "Update src/a.ts again" },
            {
              metadata: { files: [files[0]] },
            },
          ),
        ),
      ]),
    )

    return (
      <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <button type="button" onClick={() => setState("calls", (count) => count + 1)}>
          Append tool call
        </button>
        <CurrentSessionProviders document={document()}>
          <SessionTimeline document={document()} />
        </CurrentSessionProviders>
      </section>
    )
  },
}

export const ChangingFiles = {
  args: { scenario: "streaming" },
  argTypes: { scenario: { control: "select", options: Object.keys(fileScenarios) } },
  render: (args: { scenario: keyof typeof fileScenarios }) => (
    <Dynamic component={fileScenarios[args.scenario]?.render ?? fileScenarios.streaming.render} />
  ),
}

export const CreatedANewFile = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Created a new file"
      description="A completed write renders the generated Markdown file through the production file viewer."
      document={writeFileDocument}
      width="760px"
      editToolDefaultOpen
    />
  ),
}

export const FileToolFallbacks = {
  args: { tool: "edit", empty: false, forceOpen: false, controlled: true, completed: false },
  argTypes: {
    tool: { control: "select", options: ["edit", "write"] },
    empty: { control: "boolean" },
    forceOpen: { control: "boolean" },
    controlled: { control: "boolean" },
  },
  render: (args: { tool: string; empty: boolean; forceOpen: boolean; controlled: boolean; completed: boolean }) => {
    const [state, setState] = createStore({ completed: args.completed, open: false })
    createEffect(() => setState("completed", args.completed))

    return (
      <section class="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <button type="button" onClick={() => setState("completed", true)}>
          Complete file tool
        </button>
        <CurrentSessionProviders document={storyDocument([])}>
          <ToolDisplay
            id="tool_file_fallback"
            tool={args.tool}
            status={state.completed ? "completed" : "running"}
            input={{
              path: "src/example.ts",
              oldString: "export const before = true\n",
              newString: "export const after = true\n",
              content: args.empty ? "" : "export const written = true\n",
            }}
            metadata={{
              diagnostics: state.completed
                ? {
                    "src/example.ts": [
                      { severity: 1, message: "Example diagnostic", range: { start: { line: 0, character: 0 } } },
                    ],
                  }
                : {},
            }}
            open={args.controlled ? state.open : undefined}
            onOpenChange={(open) => setState("open", open)}
            forceOpen={args.forceOpen}
          />
        </CurrentSessionProviders>
      </section>
    )
  },
}
