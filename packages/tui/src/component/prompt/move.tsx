import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import path from "path"
import { useTuiPaths } from "../../context/runtime"
import { errorMessage } from "../../util/error"
import { useDialog } from "../../ui/dialog"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useToast } from "../../ui/toast"
import { DialogMoveSession, type MoveSessionSelection } from "../dialog-move-session"
import { DialogWorkspaceFileChanges } from "../dialog-workspace-file-changes"
import { useHomeSessionDestination } from "../../routes/home/session-destination"
import { useProject } from "../../context/project"

function moveReminderText(directory: string) {
  return `<system-reminder>The user has changed the current working directory to "${directory}". This is still the same project but at a possibly new location; take this into account when working with any files from now on.</system-reminder>`
}

export async function resolvePromptMoveDirectory(input: {
  selection: MoveSessionSelection
  create: () => Promise<string | undefined>
  validate: (directory: string) => Promise<void>
  onUnavailable: (error: unknown) => void
}) {
  const directory = input.selection.type === "new" ? await input.create() : input.selection.directory
  if (!directory) return undefined
  try {
    await input.validate(directory)
    return directory
  } catch (error) {
    input.onUnavailable(error)
    return undefined
  }
}

export function usePromptMove(input: { projectID: () => string | undefined; sessionID: () => string | undefined }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const homeDestination = useHomeSessionDestination()
  const project = useProject()
  const paths = useTuiPaths()
  const [creating, setCreating] = createSignal(false)
  const [creatingDots, setCreatingDots] = createSignal(3)
  const [progress, setProgress] = createSignal<string>()

  async function create(context?: string) {
    const projectID = input.projectID()
    if (!projectID) return undefined
    setCreating(true)
    setProgress("Creating copy")
    try {
      const generated = await sdk.client.experimental.projectCopy.generateName(
        { projectID, context },
        { throwOnError: true },
      )
      const result = await sdk.client.v2.projectCopy.create(
        {
          projectID,
          location: { directory: sdk.directory },
          strategy: "git_worktree",
          directory: path.join(paths.worktree, projectID.slice(0, 6)),
          name: generated.data.name,
        },
        { throwOnError: true },
      )
      const directory = result.data?.directory
      if (!directory) throw new Error("No project copy directory returned")

      // Call a location-based route to make sure it's bootstrapped
      // before moving on
      await sdk.client.path.get({ directory }, { throwOnError: true })

      setProgress("Creating session")
      return directory
    } catch (err) {
      homeDestination?.clear()
      setProgress(undefined)
      setCreating(false)
      toast.show({ title: "Creating workspace failed", message: errorMessage(err), variant: "error" })
      return undefined
    }
  }

  async function validateDirectory(directory: string) {
    await sdk.client.path.get({ directory }, { throwOnError: true })
  }

  function showUnavailableDirectory(error: unknown) {
    toast.show({ title: "Project unavailable", message: errorMessage(error), variant: "error" })
  }

  function open() {
    const projectID = input.projectID()
    if (!projectID) return
    const sessionID = input.sessionID()
    const session = sessionID ? sync.session.get(sessionID) : undefined
    dialog.replace(() => (
      <DialogMoveSession
        projectID={projectID}
        current={
          homeDestination?.destination() ??
          (session
            ? {
                type: "directory",
                directory: session.directory,
                subdirectory: !!session.path,
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
            if (selection.type === "new") {
              homeDestination?.setDestination(selection)
              dialog.clear()
              return
            }
            void resolvePromptMoveDirectory({
              selection,
              create: async () => undefined,
              validate: validateDirectory,
              onUnavailable: showUnavailableDirectory,
            }).then((directory) => {
              if (!directory) return
              homeDestination?.setDestination({ ...selection, directory })
              dialog.clear()
            })
            return
          }
          void moveExistingSession(sessionID, selection)
        }}
      />
    ))
  }

  function sessionContext(sessionID: string) {
    const session = sync.session.get(sessionID)
    const messages = (sync.data.message[sessionID] ?? [])
      .slice(-6)
      .map((message) =>
        [
          message.role + ":",
          ...(sync.data.part[message.id] ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])),
        ].join(" "),
      )
    return [session?.title, ...messages].filter(Boolean).join("\n") || undefined
  }

  async function moveExistingSession(sessionID: string, selection: MoveSessionSelection) {
    const session = sync.session.get(sessionID)
    const status = await sdk.client.vcs.status({ directory: session?.directory }).catch(() => undefined)
    const choice = status?.data?.length ? await DialogWorkspaceFileChanges.show(dialog, status.data) : "no"
    if (!choice) return
    const directory = await resolvePromptMoveDirectory({
      selection,
      create: () => create(sessionContext(sessionID)),
      validate: validateDirectory,
      onUnavailable: showUnavailableDirectory,
    })
    if (!directory) {
      setProgress(undefined)
      return
    }
    dialog.clear()
    setProgress("Moving session")
    try {
      await sdk.client.experimental.controlPlane.moveSession(
        {
          sessionID,
          destination: { directory },
          moveChanges: choice === "yes",
        },
        { throwOnError: true },
      )
      await sdk.client.session
        .promptAsync({
          sessionID,
          directory,
          noReply: true,
          parts: [
            {
              type: "text",
              text: moveReminderText(directory),
              synthetic: true,
            },
          ],
        })
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

  const pending = createMemo(() => Boolean(homeDestination?.destination()))
  const pendingNew = createMemo(() => homeDestination?.destination()?.type === "new")

  async function getDirectory(context?: string) {
    const value = homeDestination?.destination()
    if (!value) return undefined
    return await resolvePromptMoveDirectory({
      selection: value,
      create: () => create(context),
      validate: validateDirectory,
      onUnavailable: showUnavailableDirectory,
    })
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
