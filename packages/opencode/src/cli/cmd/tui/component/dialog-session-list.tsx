import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { useProjectState } from "../context/directory"
import { Global } from "@/global"
import path from "path"
import { Spinner } from "./spinner"

type SessionOptionValue = {
  id: string
  directory: string
}

const SESSION_FETCH_LIMIT = 200

export function DialogSessionList(
  props: {
    project?: string
    initialSearch?: string
    initialSelection?: SessionOptionValue
    initialScrollTop?: number
  } = {},
) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()
  const projectState = useProjectState()
  const clientCache = new Map<string, ReturnType<typeof sdk.createClient>>()
  const sessionCache = new Map<string, typeof sync.data.session>()
  let dialogRef: DialogSelectRef<SessionOptionValue> | undefined

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal(props.initialSearch ?? "", 150)

  const currentProject = createMemo(() => sync.data.path.directory || projectState.current || process.cwd())
  const activeProject = createMemo(() => props.project ?? currentProject())
  const isCurrentProject = createMemo(() => activeProject() === currentProject())

  const clientFor = (project: string) => {
    const current = currentProject()
    if (project === current) return sdk.client
    const cached = clientCache.get(project)
    if (cached) return cached
    const client = sdk.createClient(project)
    clientCache.set(project, client)
    return client
  }

  const [searchResults] = createResource(
    () => {
      const query = search()
      if (!query) return undefined
      return { query, directory: activeProject() }
    },
    async (input) => {
      if (!input) return undefined
      const client = clientFor(input.directory)
      const result = await client.session.list({ search: input.query, limit: 30, directory: input.directory })
      return result.data ?? []
    },
  )

  const [projectSessions] = createResource(activeProject, async (project) => {
    const current = currentProject()
    if (!project) return undefined
    if (project === current) return undefined
    const cached = sessionCache.get(project)
    if (cached) return cached
    const client = clientFor(project)
    const result = await client.session.list({ limit: SESSION_FETCH_LIMIT, directory: project })
    const data = result.data ?? []
    sessionCache.set(project, data)
    return data
  })

  const projectKeybind = createMemo(() => keybind.all.session_project?.[0])

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    const searched = searchResults()
    if (searched !== undefined) return searched
    if (!isCurrentProject()) {
      const scoped = projectSessions()
      if (scoped !== undefined) return scoped
      return sessionCache.get(activeProject()) ?? []
    }
    const current = currentProject()
    return sync.data.session.filter((item) => item.directory === current)
  })

  const currentSession = createMemo<SessionOptionValue | undefined>(() => {
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    const session = sessions().find((item) => item.id === sessionID)
    if (!session) return undefined
    return { id: session.id, directory: session.directory }
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        const value: SessionOptionValue = { id: x.id, directory: x.directory }
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  useKeyboard((evt) => {
    if (options().length > 0) return
    if (!keybind.match("session_project", evt)) return
    evt.preventDefault()
    evt.stopPropagation()
    showProjectSelect()
  })

  const showProjectSelect = () => {
    const current = activeProject()
    dialog.replace(() => (
      <DialogProjectSelect
        current={current}
        onSelect={(project: string) => {
          dialog.replace(() => <DialogSessionList project={project} />)
        }}
        onCancel={() => {
          dialog.replace(() => <DialogSessionList project={current} />)
        }}
      />
    ))
  }

  const openSession = async (option: { value: SessionOptionValue }) => {
    const sessionID = option.value.id
    const project = option.value.directory
    const current = currentProject()
    if (project !== current) {
      const display = project.replace(Global.Path.home, "~")
      const restore = {
        project: activeProject(),
        search: dialogRef?.filter ?? search(),
        selection: option.value,
        scrollTop: dialogRef?.scrollTop ?? 0,
      }
      const confirmed = await DialogConfirm.show(dialog, "Switch project", `Switch to ${display} to open this session?`)
      if (!confirmed) {
        setTimeout(() => {
          dialog.replace(() => (
            <DialogSessionList
              project={restore.project}
              initialSearch={restore.search}
              initialSelection={restore.selection}
              initialScrollTop={restore.scrollTop}
            />
          ))
        }, 1)
        return
      }
      await projectState.switchTo(project)
      await sync.bootstrap()
      route.navigate({
        type: "session",
        sessionID,
      })
      dialog.clear()
      return
    }
    route.navigate({
      type: "session",
      sessionID,
    })
    dialog.clear()
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      ref={(ref) => (dialogRef = ref)}
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSession()}
      selected={props.initialSelection}
      initialFilter={props.initialSearch}
      initialScrollTop={props.initialScrollTop}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={openSession}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          disabled: !isCurrentProject(),
          onTrigger: async (option) => {
            if (toDelete() === option.value.id) {
              sdk.client.session.delete({
                sessionID: option.value.id,
              })
              setToDelete(undefined)
              return
            }
            setToDelete(option.value.id)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          disabled: !isCurrentProject(),
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value.id} />)
          },
        },
        {
          keybind: projectKeybind(),
          title: "project",
          onTrigger: showProjectSelect,
        },
      ]}
    />
  )
}

function DialogProjectSelect(props: { current: string; onSelect: (project: string) => void; onCancel: () => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const keybind = useKeybind()

  const [projects, { refetch }] = createResource(async () => {
    const entries = (await sdk.client.project.list().catch(() => ({ data: [] }))).data ?? []
    if (entries.length === 0) return []
    const lists = await Promise.all(
      entries.map(async (entry) => {
        const client = sdk.createClient(entry.worktree)
        return (await client.session.list({ limit: SESSION_FETCH_LIMIT }).catch(() => ({ data: [] }))).data ?? []
      }),
    )

    const map = new Map<string, number>()
    for (const sessions of lists) {
      for (const session of sessions) {
        const existing = map.get(session.directory)
        if (!existing) {
          map.set(session.directory, session.time.updated)
          continue
        }
        if (session.time.updated > existing) {
          map.set(session.directory, session.time.updated)
        }
      }
    }

    return Array.from(map.entries())
      .map(([directory, updated]) => ({ directory, updated }))
      .toSorted((a, b) => b.updated - a.updated)
  })

  const options = createMemo(() => {
    const list = projects()
    if (!list) return []
    return list.map((entry) => {
      const display = entry.directory.replace(Global.Path.home, "~")
      const title = path.basename(entry.directory) || display
      return {
        title,
        value: entry.directory,
        description: Locale.truncate(display, 60),
        footer: projects.loading ? "Refreshing…" : Locale.time(entry.updated),
      }
    })
  })

  const currentSelection = createMemo(() => {
    const list = projects()
    if (!list) return undefined
    if (list.some((entry) => entry.directory === props.current)) return props.current
    return undefined
  })

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name !== "escape") return
    evt.preventDefault()
    evt.stopPropagation()
    props.onCancel()
  })

  return (
    <DialogSelect
      title="Select project"
      placeholder="Search projects"
      options={options()}
      current={currentSelection()}
      onSelect={(option) => {
        props.onSelect(option.value)
      }}
      keybind={[
        {
          keybind: keybind.all.session_project_refresh?.[0],
          title: "refresh",
          onTrigger: () => {
            refetch()
          },
        },
      ]}
    />
  )
}
