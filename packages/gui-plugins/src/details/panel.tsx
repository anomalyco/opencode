import type { MountedSession } from "@opencode/plugin/gui"
import { SessionServerPanel } from "./server-panel"

export type DetailsPanelProps = {
  session: MountedSession
  shown?: boolean
  mobile?: boolean
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
        onClose={props.onClose}
      />
    </div>
  )
}
