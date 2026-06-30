import { createMemo, createSignal } from "solid-js"
import { useData } from "../context/data"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode-ai/sdk/v2"

function Status(props: { status: McpServer["status"] }) {
  const { theme } = useTheme()
  switch (props.status.status) {
    case "connected":
      return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Connected</span>
    case "failed":
      return <span style={{ fg: theme.error }}>✗ {props.status.error}</span>
    case "needs_auth":
      return <span style={{ fg: theme.warning }}>! Needs authentication</span>
    case "needs_client_registration":
      return <span style={{ fg: theme.error }}>✗ {props.status.error}</span>
    case "disabled":
      return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
    default:
      return <span style={{ fg: theme.textMuted }}>○ Disconnected</span>
  }
}

export function DialogMcp() {
  const data = useData()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()

  const options = createMemo(() =>
    pipe(
      data.location.mcp.list() ?? [],
      sortBy((server) => server.name),
      map((server) => ({
        value: server.name,
        title: server.name,
        footer: <Status status={server.status} />,
        category: undefined,
      })),
    ),
  )

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      onSelect={() => {
        // Read-only view: selection does nothing, the dialog closes on escape.
      }}
    />
  )
}
