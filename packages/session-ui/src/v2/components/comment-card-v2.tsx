import { Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getFilenameTruncated } from "@opencode-ai/core/util/path"
import { AttachmentCardV2 } from "./attachment-card-v2"

export function CommentCardV2(props: {
  comment: string
  path: string
  selection?: { startLine: number; endLine: number }
  active?: boolean
  title?: string
  onClick?: () => void
}) {
  return (
    <AttachmentCardV2 title={props.comment} active={props.active} hover={props.title} onClick={props.onClick}>
      <FileIcon node={{ path: props.path, type: "file" }} />
      <span>
        {getFilenameTruncated(props.path, 14)}
        <Show when={props.selection}>
          {(sel) =>
            sel().startLine === sel().endLine ? `:${sel().startLine}` : `:${sel().startLine}-${sel().endLine}`
          }
        </Show>
      </span>
    </AttachmentCardV2>
  )
}
