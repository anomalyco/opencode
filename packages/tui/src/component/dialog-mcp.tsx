import { createMemo, createSignal, createResource } from "solid-js"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "../context/sdk"
import { readJulesMonitor } from "../util/jules"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

function JulesStatus(props: { status: string | undefined }) {
  const { theme } = useTheme()
  const color = () => {
    switch (props.status) {
      case "COMPLETED":
        return theme.success
      case "FAILED":
      case "BLOCKED":
        return theme.error
      case "AWAITING_USER_FEEDBACK":
        return theme.warning
      case "IN_PROGRESS":
      case "PLANNING":
      case "QUEUED":
        return theme.info
      default:
        return theme.textMuted
    }
  }
  return <span style={{ fg: color(), attributes: TextAttributes.BOLD }}>{props.status ?? "UNKNOWN"}</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)

  const workspace = createMemo(() => sync.path.directory)

  const [jules] = createResource(workspace, () => readJulesMonitor(), { initialValue: { jobs: [], log: [] } })

  const julesJobs = createMemo(() =>
    jules().jobs.filter((job) => job.workspace === workspace() || job.workspace === undefined),
  )

  const options = createMemo(() => {
    // Track sync data and loading state to trigger re-render when they change
    const mcpData = sync.data.mcp
    const loadingMcp = loading()

    const mcpOptions = pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: "MCP",
      })),
    )

    const julesOptions = julesJobs().map((job) => ({
      value: job.id,
      title: job.id.slice(0, 8),
      description: job.workspace ?? "?",
      footer: <JulesStatus status={job.status} />,
      category: "Jules",
    }))

    return [...mcpOptions, ...julesOptions]
  })

  const actions = createMemo(() => [
    {
      command: "dialog.mcp.toggle",
      title: "toggle",
      onTrigger: async (option: DialogSelectOption<string>) => {
        // Prevent toggling while an operation is already in progress
        if (loading() !== null) return
        if (option.category === "Jules") return

        setLoading(option.value)
        try {
          await local.mcp.toggle(option.value)
          // Refresh MCP status from server
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          } else {
            console.error("Failed to refresh MCP status: no data returned")
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      actions={actions()}
      onSelect={(_option) => {
        // Don't close on select, only on escape
      }}
    />
  )
}
