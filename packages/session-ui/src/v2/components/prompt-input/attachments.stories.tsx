import { createSignal } from "solid-js"
import { PromptInputV2Attachments } from "."
import type { PromptInputV2Attachment, PromptInputV2Comment } from "./types"

const preview = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="58" height="46"><rect width="58" height="46" fill="#6690bf"/></svg>',
)}`

const files: PromptInputV2Attachment[] = [
  {
    type: "image",
    id: "one",
    filename: "first-screenshot.svg",
    mime: "image/svg+xml",
    blob: { id: "one", url: preview },
  },
  {
    type: "image",
    id: "two",
    filename: "second-screenshot.svg",
    mime: "image/svg+xml",
    blob: { id: "two", url: preview },
  },
  {
    type: "image",
    id: "three",
    filename: "design-notes.pdf",
    mime: "application/pdf",
    blob: { id: "three", url: "" },
  },
]

const notes: PromptInputV2Comment[] = [
  { type: "file", key: "comment", path: "src/components/tooltip.tsx", comment: "Check this transition" },
]

export default {
  title: "Session UI/PromptInputV2/Attachments",
  id: "session-ui-prompt-input-v2-attachments",
  component: PromptInputV2Attachments,
  parameters: {
    frameHeight: "260px",
    docs: {
      description: {
        component:
          "Hover a comment or attachment until its tooltip opens, then move to another item. The next tooltip should appear immediately. After leaving the strip for 300ms, the normal delay returns.",
      },
    },
  },
}

export const HoverHandoff = {
  render: () => {
    const [attachments, setAttachments] = createSignal(files)
    const [comments, setComments] = createSignal(notes)

    return (
      <div class="max-w-[600px] pt-20">
        <PromptInputV2Attachments
          attachments={attachments()}
          comments={comments()}
          removeLabel="Remove"
          onAttachmentRemove={(item) => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}
          onCommentRemove={(item) => setComments((current) => current.filter((entry) => entry.key !== item.key))}
        />
      </div>
    )
  },
}
