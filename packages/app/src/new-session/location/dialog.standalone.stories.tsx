import { Button } from "@opencode/ui/button"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DialogStoryRuntime,
  STORY_DIRECTORY,
  STORY_PROJECTS,
  STORY_SERVER,
} from "@/components-lab/dialog-story-runtime"
import { createPromptProjectController, type PromptProject, type PromptServer } from "@/new-session/project/selector"
import { createNewSessionWorkspaceController } from "@/new-session/workspace/controller"
import { ServerConnection } from "@/runtime/server/registry"
import { useNewSessionLocationDialog } from "./dialog"

const currentServer: PromptServer = {
  key: ServerConnection.key(STORY_SERVER),
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

type LocationScenario = { multipleServers?: boolean; step?: "branches" | "worktrees" }

function LocationDialogStory(props: LocationScenario) {
  const [store, setStore] = createStore<{
    directory: string
    worktree?: string
    branch?: string
  }>({
    directory: STORY_DIRECTORY,
  })

  const available = (): PromptProject[] => [
    ...STORY_PROJECTS.map((project, index) => ({
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
      projectID: STORY_PROJECTS[0].id,
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

  const open = () => openLocation(props.step ? { step: props.step, project: project.selected() } : undefined)

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

const story = (scenario: LocationScenario = {}) => ({
  render: () => (
    <DialogStoryRuntime>
      <LocationDialogStory {...scenario} />
    </DialogStoryRuntime>
  ),
})

export const Default = story()

export const MultipleServers = story({ multipleServers: true })

export const Worktrees = story({ step: "worktrees" })

export const BaseBranch = story({ step: "branches" })
