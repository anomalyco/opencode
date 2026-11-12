import type { MountedSession } from "@opencode/plugin/gui"
import { SessionServerPanel, type McpControllers } from "./server-panel"

export type DetailsPanelProps = {
  session: MountedSession
  shown?: boolean
  mobile?: boolean
  /** The plugin instance's MCP controllers, which outlive each panel. */
  mcp: McpControllers
  /** Closes the popover that shows the panel, once an action opened something beside it. */
  onClose?: () => void
}

export default function SessionDetailsPanel(props: DetailsPanelProps) {
  return (
    <div data-component="session-summary-panel" data-mobile={props.mobile || undefined}>
      <SessionServerPanel
        session={props.session}
        directory={props.session.directory}
        shown={props.shown !== false}
        mobile={props.mobile}
        mcp={props.mcp}
        onClose={props.onClose}
      />
    </div>
  )
}
