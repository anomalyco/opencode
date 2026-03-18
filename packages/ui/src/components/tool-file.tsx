import { Show } from "solid-js"
import { FileIcon } from "./file-icon"
import { getFilename } from "@opencode-ai/util/path"

export function ToolFile(props: { path: string; dir?: string; onClick?: () => void }) {
  return (
    <div data-slot="apply-patch-file-info">
      <FileIcon node={{ path: props.path, type: "file" }} />
      <div data-slot="apply-patch-file-name-container">
        <Show when={props.dir}>
          <span data-slot="apply-patch-directory">{`\u202A${props.dir}\u202C`}</span>
        </Show>
        <Show when={props.onClick} fallback={<span data-slot="apply-patch-filename">{getFilename(props.path)}</span>}>
          <button
            type="button"
            data-slot="apply-patch-filename"
            onClick={(event) => {
              event.stopPropagation()
              props.onClick?.()
            }}
          >
            {getFilename(props.path)}
          </button>
        </Show>
      </div>
    </div>
  )
}
