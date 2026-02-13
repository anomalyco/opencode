import { createSignal } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useServer } from "@/context/server"
import { useAuth } from "../utils/auth-client"
import { api, getDefaultBaseUrl } from "../utils/api"
import type { WebProjectDialogProps } from "@opencode-ai/app-shared"

interface CreateWorkspaceResult {
  workspaceId: string
  directory?: string
  workspaceBaseUrl?: string
}

/**
 * Create a cloud project/sandbox via the Claxedo API.
 */
async function createCloudProject(
  baseUrl: string,
  name: string,
  repoUrl: string,
): Promise<CreateWorkspaceResult> {
  return api.post<CreateWorkspaceResult>(`${baseUrl}/api/workspace/create`, {
    projectName: name,
    workspaceName: "main",
    repoUrl,
  })
}

/**
 * DialogCreateCloudProject component for creating new cloud projects.
 * Allows users to clone a Git repository into a cloud sandbox.
 *
 * Implements WebProjectDialogProps from app-shared.
 */
export function DialogCreateCloudProject(props: WebProjectDialogProps) {
  const [repoUrl, setRepoUrl] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const { user } = useAuth()
  const dialog = useDialog()

  const baseUrl = getDefaultBaseUrl()

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!repoUrl()) return

    setLoading(true)
    try {
      const name = repoUrl().split("/").pop()?.replace(".git", "") || "Untitled"
      const created = await createCloudProject(baseUrl, name, repoUrl())

      // Open the repo directory inside the sandbox.
      const worktree = created.directory
      if (!worktree) throw new Error("Workspace create did not return a directory")

      props.onSelect(worktree)

      dialog.close()
    } catch (err) {
      console.error(err)
      alert("Failed to create project")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog title="New Cloud Project">
      <div class="p-4 min-w-[400px]">
        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm text-neutral-400 mb-1">
              Git Repository URL
            </label>
            <input
              type="text"
              value={repoUrl()}
              onInput={(e) => setRepoUrl(e.currentTarget.value)}
              placeholder="https://github.com/username/repo"
              class="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              autofocus
            />
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <Button type="submit" disabled={loading() || !repoUrl()}>
              {loading() ? "Cloning..." : "Clone & Open"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
