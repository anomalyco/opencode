import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createResource, createMemo, onMount } from "solid-js"
import { useSDK } from "../context/sdk"
import os from "os"

interface MigrateSession {
  id: string
  title: string
  directory: string
  projectID: string
  time: { created: number; updated: number }
  project: { id: string; name?: string; worktree: string } | null
}

interface DialogSessionRescueProps {
  session: MigrateSession
  onDone: () => void
}

export function DialogSessionRescue(props: DialogSessionRescueProps) {
  const dialog = useDialog()
  const sdk = useSDK()

  const [data] = createResource(async () => {
    const [cur, all] = await Promise.all([sdk.client.project.current(), sdk.client.project.list()])
    return { current: cur.data, projects: all.data ?? [] }
  })

  const options = createMemo(() => {
    const result: Array<{
      title: string
      value: { projectID: string; directory: string }
      description?: string
      category?: string
    }> = []

    const proj = data()?.current
    if (proj) {
      const dir = sdk.directory ?? proj.worktree
      result.push({
        title: proj.name ?? proj.worktree,
        value: { projectID: proj.id, directory: dir },
        description: dir,
        category: "Current",
      })
    }

    result.push({
      title: "Home (~)",
      value: { projectID: "global", directory: os.homedir() },
      description: os.homedir(),
      category: "Special",
    })

    for (const p of data()?.projects ?? []) {
      if (p.id === proj?.id) continue
      if (p.id === "global") continue
      result.push({
        title: p.name ?? p.worktree,
        value: { projectID: p.id, directory: p.worktree },
        description: p.worktree,
        category: "Projects",
      })
    }

    return result
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={`Migrate: ${props.session.title}`}
      placeholder="Choose destination"
      options={options()}
      onSelect={async (option) => {
        await sdk.client.session.migrate({
          sessionID: props.session.id,
          projectID: option.value.projectID,
          body_directory: option.value.directory,
        })
        props.onDone()
        const { DialogSessionMigrate } = await import("./dialog-session-migrate")
        dialog.replace(() => <DialogSessionMigrate />)
      }}
    />
  )
}
