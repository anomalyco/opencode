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
import { SessionTimeline } from "./session-timeline"

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

function EditSiblingUpdateStory() {
  const [state, setState] = createStore({ sibling: false })
  const document = createMemo(() => ({
    ...editThenTestDocument,
    messages: editThenTestDocument.messages
      .filter((message) => message.id === "msg_user_edit" || message.id === "msg_assistant_edit")
      .map((message) => {
        if (message.type !== "assistant" || !state.sibling) return message
        return {
          ...message,
          content: [
            ...message.content,
            { type: "text" as const, text: "Streaming added a later assistant text part." },
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

export const EditWithStreamedSibling = { render: () => <EditSiblingUpdateStory /> }

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
