import { Button } from "@opencode/ui/button"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DialogLabRuntime,
  LAB_DIRECTORY,
  LAB_PROJECTS,
  LAB_SERVER,
} from "@/lab/dialog-runtime"
import { createPromptProjectController, type PromptProject, type PromptServer } from "@/new-session/project/selector"
import { createNewSessionWorkspaceController } from "@/new-session/workspace/controller"
import { ServerConnection } from "@/runtime/server/registry"
import { useNewSessionLocationDialog } from "./dialog"

const currentServer: PromptServer = {
  key: ServerConnection.key(LAB_SERVER),
  name: "MacBook-Pro",
  hint: "This computer",
  kind: "current",
}

const sshServer: PromptServer = {
  key: "ssh:devbox",
  name: "devbox",
  kind: "plugin",
  label: "SSH",
}

type LocationScenario = { multipleServers?: boolean; worktrees?: boolean }

function LocationDialogLab(props: LocationScenario) {
  const [store, setStore] = createStore<{
    directory: string
    worktree?: string
    branch?: string
  }>({
    directory: LAB_DIRECTORY,
  })

  const available = (): PromptProject[] => [
    ...LAB_PROJECTS.map((project, index) => ({
      id: project.id,
      name: project.name,
      worktree: project.worktree,
      vcs: "git",
      sandboxes: project.sandboxes,
      worktrees: project.sandboxes.map((directory) => ({ directory, strategy: "git" })),
      used: index === 0,
      server: currentServer,
      time: { active: project.time.active },
    })),
    ...(props.multipleServers
      ? [
          {
            id: "prj_remote_api",
            name: "cloud-api",
            worktree: "/home/dev/cloud-api",
            vcs: "git",
            used: true,
            server: sshServer,
            time: { active: Date.now() - 3_600_000 },
          },
        ]
      : []),
  ]

  const project = createPromptProjectController({
    controls: () => ({
      available: available(),
      servers: props.multipleServers ? [currentServer, sshServer] : [currentServer],
      directory: store.directory,
      projectID: LAB_PROJECTS[0].id,
      server: currentServer.key,
      select: (directory, _server, workspace) => {
        setStore({ directory, worktree: workspace })
      },
      add: () => {},
    }),
  })

  const workspace = createNewSessionWorkspaceController({
    selectedWorktree: () => store.worktree,
    selectedBranch: () => store.branch,
    setSelectedWorktree: (worktree) => setStore("worktree", worktree),
    setSelectedBranch: (branch) => setStore("branch", branch),
  })

  const openLocation = useNewSessionLocationDialog({
    project,
    workspace,
    onDone: () => {},
  })

  const open = () => openLocation(props.worktrees ? { project: project.selected() } : undefined)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open session location dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/New Session Location",
  id: "app-dialog-new-session-location",
}

const state = (scenario: LocationScenario = {}) => ({
  render: () => (
    <DialogLabRuntime>
      <LocationDialogLab {...scenario} />
    </DialogLabRuntime>
  ),
})

export const Default = state()

export const MultipleServers = state({ multipleServers: true })

export const Worktrees = state({ worktrees: true })
