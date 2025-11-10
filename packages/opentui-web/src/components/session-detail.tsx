import type { Component } from "solid-js"
import { createMemo } from "solid-js"
import { useSync } from "../context/sync"
import { SessionNavigation } from "./session-navigation"
import { MessageList } from "./message-list"
import { PromptInput } from "./prompt-input"

interface SessionDetailProps {
  sessionID: string
  onBack: () => void
}

export const SessionDetail: Component<SessionDetailProps> = (props) => {
  const sync = useSync()
  const session = createMemo(() => sync.session.get(props.sessionID))

  const hasParent = () => !!session()?.parentID

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: 1,
        overflow: "hidden",
        background: "#1a1a1a",
      }}
    >
      {/* Top Navigation */}
      <SessionNavigation
        sessionTitle={session()?.title || "Viewing session"}
        hasParent={hasParent()}
        hasPrevious={false}
        hasNext={false}
        onBack={props.onBack}
      />

      {/* Messages */}
      <MessageList sessionID={props.sessionID} />

      {/* Input */}
      <PromptInput sessionID={props.sessionID} />
    </div>
  )
}
