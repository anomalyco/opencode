import { createTwoFilesPatch } from "diff"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  editThenTestDocument,
  fileChangeLoadingDocument,
  fileChangeRunningDocument,
  multiFilePatchDocument,
  writeFileDocument,
} from "../storybook/current-session-fixtures"
import { storyDocument, storyPatchFile, storyTool } from "../storybook/current-session-scenarios"
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

const fileScenarios = {
  repeated: RepeatedEdits,
  streaming: EditWithStreamedSibling,
  patch: ThreeFilePatch,
  write: WrittenSource,
}

export const AppendingToolCalls = {
  render: () => {
    const [state, setState] = createStore({ calls: 0 })
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
  render: (args: { scenario: string }) => fileScenarios[args.scenario as keyof typeof fileScenarios].render(),
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
  args: { tool: "edit", empty: false, forceOpen: false, controlled: true },
  argTypes: {
    tool: { control: "select", options: ["edit", "write"] },
    empty: { control: "boolean" },
    forceOpen: { control: "boolean" },
    controlled: { control: "boolean" },
  },
  render: (args: { tool: string; empty: boolean; forceOpen: boolean; controlled: boolean }) => {
    const [state, setState] = createStore({ completed: false, open: false })
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
