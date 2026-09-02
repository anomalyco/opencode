import { File } from "@opencode-ai/session-ui/file"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { Button } from "@opencode-ai/ui/button"
import { createStore } from "solid-js/store"
import { createReviewEditor } from "./editor"
import { ReviewFilePreview } from "./file-preview"

function WorkspacesStory() {
  const [state, setState] = createStore({ directory: "/workspace-a" })
  const files = new Map<string, Uint8Array>([
    ["/workspace-a", new TextEncoder().encode("// Workspace A\n")],
    ["/workspace-b", new TextEncoder().encode("// Workspace B\n")],
  ])
  const editor = createReviewEditor({
    directory: () => state.directory,
    read: async (directory) => files.get(directory)!,
    write: async (directory, _path, contents) => {
      files.set(directory, contents)
    },
    onSaved() {},
  })
  return (
    <FileComponentProvider component={File}>
      <div class="flex h-[560px] max-w-[800px] flex-col gap-3">
        <div class="flex gap-2">
          <Button onClick={() => setState("directory", "/workspace-a")}>Workspace A</Button>
          <Button onClick={() => setState("directory", "/workspace-b")}>Workspace B</Button>
          <span>{state.directory}</span>
        </div>
        <div data-component="session-review-v2" class="border border-border-base">
          <ReviewFilePreview
            file="src/shared.ts"
            diff={{
              file: "src/shared.ts",
              status: "modified",
              additions: 1,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-before\n+after\n",
            }}
            diffStyle="unified"
            editor={editor}
          />
        </div>
      </div>
    </FileComponentProvider>
  )
}

export default {
  title: "OpenCode/Review/Editing",
  id: "app-review-editing",
  component: WorkspacesStory,
}

export const Workspaces = { render: () => <WorkspacesStory /> }
