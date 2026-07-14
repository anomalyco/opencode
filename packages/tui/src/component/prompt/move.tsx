import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import path from "path"
import { useTuiPaths } from "../../context/runtime"
import { errorMessage } from "../../util/error"
import { useDialog } from "../../ui/dialog"
import { useClient } from "../../context/client"
import { useToast } from "../../ui/toast"
import { DialogMoveSession, type MoveSessionSelection } from "../dialog-move-session"
import { DialogWorkspaceFileChanges } from "../dialog-workspace-file-changes"
import { useHomeSessionDestination } from "../../routes/home/session-destination"
import { useProject } from "../../context/project"
import { useData } from "../../context/data"

function moveReminderText(directory: string) {
  return `<system-reminder>The user has changed the current working directory to "${directory}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`
}

export function usePromptMove(input: { projectID: () => string | undefined; sessionID: () => string | undefined }) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const homeDestination = useHomeSessionDestination()
  const project = useProject()
  const data = useData()
  const paths = useTuiPaths()
  const [creating, setCreating] = createSignal(false)
  const [creatingDots, setCreatingDots] = createSignal(3)
  const [progress, setProgress] = createSignal<string>()

  async function create(name: string) {
    const projectID = await resolveProjectID()
    if (!projectID) return
    setCreating(true)
    setProgress("Creating copy")
    try {
      const result = await client.api.projectCopy.create({
        projectID,
        location: { directory: project.instance.directory() || paths.cwd },
        strategy: "git_worktree",
        directory: path.join(paths.worktree, projectID.slice(0, 6)),
        name,
      })
      const directory = result.directory
      if (!directory) throw new Error("No project copy directory returned")

      // Call a location-based route to make sure it's bootstrapped before moving on.
      await client.api.location.get({ location: { directory } })

      setProgress("Creating session")
      return directory
    } catch (err) {
      homeDestination?.clear()
      setProgress(undefined)
      setCreating(false)
      toast.show({ title: "Creating workspace failed", message: errorMessage(err), variant: "error" })
      return
    }
  }

  async function open() {
    const projectID = await resolveProjectID()
    if (!projectID) {
      toast.show({ message: "Unable to determine current project", variant: "error" })
      return
    }
    const sessionID = input.sessionID()
    const session = sessionID ? await resolveSession(sessionID) : undefined
    dialog.replace(() => (
      <DialogMoveSession
        projectID={projectID}
        current={
          homeDestination?.destination() ??
          (session
            ? {
                type: "directory",
                directory: session.location.directory,
                subdirectory: !!session.subpath,
              }
            : {
                type: "directory",
                directory: project.instance.directory(),
                subdirectory: project.instance.directory() !== project.instance.path().worktree,
              })
        }
        onCurrentChange={(selection) => homeDestination?.setDestination(selection)}
        onSelect={(selection) => {
          const sessionID = input.sessionID()
          if (!sessionID) {
            homeDestination?.setDestination(selection)
            dialog.clear()
            return
          }
          void moveExistingSession(sessionID, selection)
        }}
      />
    ))
  }

  async function moveExistingSession(sessionID: string, selection: MoveSessionSelection) {
    const session = await resolveSession(sessionID)
    const status = await client.api.vcs
      .status({ location: session?.location.directory ? { directory: session.location.directory } : undefined })
      .catch(() => undefined)
    const choice = status?.data?.length ? await DialogWorkspaceFileChanges.show(dialog, status.data) : "no"
    if (!choice) return
    dialog.clear()
    const directory = selection.type === "new" ? await create(selection.name) : selection.directory
    if (!directory) {
      setProgress(undefined)
      dialog.clear()
      return
    }
    setProgress("Moving session")
    try {
      await client.api.session.move({ sessionID, destination: { directory }, moveChanges: choice === "yes" })
      await client.api.session
        .synthetic({ sessionID, text: moveReminderText(directory), resume: false })
        .catch(() => undefined)
      dialog.clear()
    } catch (error) {
      toast.error(error)
      dialog.clear()
    } finally {
      setProgress(undefined)
      setCreating(false)
    }
  }

  async function resolveProjectID() {
    const projectID = input.projectID()
    if (projectID) return projectID
    const sessionID = input.sessionID()
    if (sessionID) return (await resolveSession(sessionID))?.projectID
    return client.api.project
      .current({ location: { directory: project.instance.directory() || paths.cwd } })
      .then((project) => project.id)
      .catch(() => undefined)
  }

  async function resolveSession(sessionID: string) {
    const session = data.session.get(sessionID)
    if (session) return session
    await data.session.refresh(sessionID).catch(() => undefined)
    return data.session.get(sessionID)
  }

  const pending = createMemo(() => Boolean(homeDestination?.destination()))
  const pendingNew = createMemo(() => homeDestination?.destination()?.type === "new")

  async function getDirectory() {
    const value = homeDestination?.destination()
    if (!value) return
    if (value.type === "directory") {
      return value.directory
    }
    return await create(value.name)
  }

  function startSubmit() {
    if (progress()) setProgress("Submitting prompt")
  }

  function finishSubmit() {
    homeDestination?.clear()
    setProgress(undefined)
    setCreating(false)
  }

  createEffect(() => {
    if (!creating()) {
      setCreatingDots(3)
      return
    }
    const timer = setInterval(() => setCreatingDots((dots) => (dots % 3) + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })

  return {
    creating,
    creatingDots,
    finishSubmit,
    getDirectory,
    open,
    pending,
    pendingNew,
    progress,
    startSubmit,
  }
}
