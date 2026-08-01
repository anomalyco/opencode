import type { BackgroundJobInfo } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { BuiltinTuiPlugin } from "../builtins"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"

const id = "internal:background-jobs"

const POLL_MS = 5000

function formatTime(ms: number | string) {
  const elapsed = Date.now() - Number(ms)
  if (!Number.isFinite(elapsed)) return "?"
  if (elapsed < 60_000) return `${Math.round(elapsed / 1000)}s`
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)}m`
  return `${Math.round(elapsed / 3_600_000)}h`
}

function jobLabel(job: BackgroundJobInfo) {
  return job.command ?? job.title ?? job.id
}

function runningJobs(jobs: BackgroundJobInfo[] | undefined) {
  return jobs?.filter((job) => job.status === "running") ?? []
}

function View(props: { api: TuiPluginApi }) {
  const [jobs, setJobs] = createSignal<BackgroundJobInfo[]>([])
  const [lock, setLock] = createSignal(false)

  const refresh = async () => {
    try {
      const directory = props.api.state.path.directory
      const result = await props.api.client.experimental.background.list(
        { directory },
        { throwOnError: true },
      )
      setJobs(result.data ?? [])
    } catch {
      // server may be unavailable during startup; next poll retries
    }
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const rows = (): DialogSelectOption<string>[] =>
    jobs().map((job) => ({
      title: jobLabel(job),
      value: job.id,
      description: `${job.status} · started ${formatTime(job.startedAt)}${job.status === "running" ? " · press enter to cancel" : ""}`,
      disabled: job.status !== "running",
    }))

  const cancel = async (jobID: string) => {
    if (lock()) return
    setLock(true)
    try {
      const directory = props.api.state.path.directory
      const result = await props.api.client.experimental.background.cancel(
        { jobID, directory },
        { throwOnError: true },
      )
      const job = jobs().find((x) => x.id === jobID)
      props.api.ui.toast({
        variant: result.data ? "success" : "error",
        message: result.data ? `Cancelled background job ${job ? jobLabel(job) : jobID}` : "Job already finished",
      })
    } catch {
      props.api.ui.toast({ variant: "error", message: "Failed to cancel background job" })
    } finally {
      setLock(false)
      await refresh()
    }
  }

  const close = () => props.api.ui.dialog.clear()

  return (
    <DialogSelect
      title="Background jobs"
      placeholder="Filter jobs…"
      options={rows()}
      skipFilter={false}
      onSelect={(item) => {
        const job = jobs().find((x) => x.id === item.value)
        if (job?.status !== "running") return
        void cancel(job.id)
      }}
      actions={[
        {
          title: "cancel",
          command: "background.cancel",
          hidden: lock(),
          onTrigger: (item) => {
            const job = jobs().find((x) => x.id === item.value)
            if (job?.status !== "running") return
            void cancel(job.id)
          },
        },
      ]}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

function RunningJobs(props: { api: TuiPluginApi }) {
  const [running, setRunning] = createSignal<BackgroundJobInfo[]>([])

  const refresh = async () => {
    try {
      const directory = props.api.state.path.directory
      const result = await props.api.client.experimental.background.list(
        { directory },
        { throwOnError: true },
      )
      setRunning(runningJobs(result.data))
    } catch {
      setRunning([])
    }
  }

  createEffect(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const theme = () => props.api.theme.current

  return (
    <Show when={running().length > 0}>
      <box
        onMouseUp={() => show(props.api)}
        backgroundColor={theme().backgroundElement}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
      >
        <text fg={theme().text}>
          <span style={{ fg: theme().warning }}>⌁</span> {running().length} bg
        </text>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      app_bottom() {
        return <RunningJobs api={api} />
      },
    },
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "background.jobs",
        title: "Background jobs",
        category: "System",
        namespace: "palette",
        run() {
          show(api)
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("background.palette", ["background.jobs"]),
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
