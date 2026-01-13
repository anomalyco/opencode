import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import "./session-view-tabs.css"

export type SessionView = "chat" | "flow"

export interface SessionViewTabsProps {
  value: SessionView
  onChange: (view: SessionView) => void
}

export function SessionViewTabs(props: SessionViewTabsProps) {
  return (
    <Tabs value={props.value} onChange={(v) => props.onChange(v as SessionView)} data-component="session-view-tabs">
      <Tabs.List>
        <Tabs.Trigger value="chat">
          <Icon name="speech-bubble" />
          <span>Chat</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="flow">
          <Icon name="brain" />
          <span>Agent Flow</span>
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>
  )
}
