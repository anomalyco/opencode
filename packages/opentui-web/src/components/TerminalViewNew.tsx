import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { TerminalLayout, MainScreen } from "../grid-components"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"

export const TerminalView: Component = () => {
  const sync = useSync()
  const sdk = useSDK()

  const [selectedSessionID, setSelectedSessionID] = createSignal<string | null>(null)
  const [inputText, setInputText] = createSignal("")

  const sessions = () => {
    // Get all sessions (parents and children)
    const allSessions = sync.data.session

    // Build session tree
    const result: Array<{ id: string; title: string; timestamp?: number; hasChildren?: boolean; parentID?: string }> =
      []

    // First add parent sessions
    allSessions
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .forEach((parent) => {
        result.push({
          id: parent.id,
          title: parent.title,
          timestamp: parent.time.updated,
          hasChildren: allSessions.some((child) => child.parentID === parent.id),
        })

        // Add children if parent has any
        const children = allSessions
          .filter((child) => child.parentID === parent.id)
          .sort((a, b) => b.time.updated - a.time.updated)

        children.forEach((child) => {
          result.push({
            id: child.id,
            title: child.title,
            timestamp: child.time.updated,
            parentID: parent.id,
            hasChildren: false,
          })
        })
      })

    return result
  }

  const messages = () => {
    if (!selectedSessionID()) return []
    return (sync.data.message[selectedSessionID()!] || []).map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: sync.data.part[msg.id] || [],
      time: msg.time,
    }))
  }

  const todos = () => {
    if (!selectedSessionID()) {
      console.log("[TerminalView] todos() - no selected session")
      return []
    }
    const sessionID = selectedSessionID()!
    const todoData = sync.data.todo[sessionID] || []
    console.log(`[TerminalView] todos() - sessionID: ${sessionID}, count: ${todoData.length}`, todoData)
    console.log(`[TerminalView] todos() - full sync.data.todo:`, sync.data.todo)
    return todoData
  }

  const subagents = () => {
    if (!selectedSessionID()) return []
    // Get child sessions (subagents) for the current session
    return sync.data.session
      .filter((s) => s.parentID === selectedSessionID())
      .sort((a, b) => b.time.updated - a.time.updated)
      .map((session) => ({
        id: session.id,
        title: session.title,
        status: "running" as const, // TODO: Derive actual status from session state
        time: session.time,
      }))
  }

  const currentAgent = () => {
    // For now, always return "general" since agentID is not part of Session type
    return "general"
  }

  const handleSelectSession = (id: string) => {
    setSelectedSessionID(id)
    sync.session.sync(id)
  }

  const handleInput = (text: string) => {
    setInputText(text)
  }

  const handleSubmit = async (text: string) => {
    if (!text.trim()) return

    // If no session, create a new one
    if (!selectedSessionID()) {
      const result = await sdk.client.session.create({
        body: { title: text.slice(0, 50) },
      })
      const newSessionID = result.data!.id
      setSelectedSessionID(newSessionID)
      sync.session.sync(newSessionID)

      // Send the initial message
      await sdk.client.session.prompt({
        path: { id: newSessionID },
        body: { parts: [{ type: "text", text }] },
      })
    } else {
      // Send message to existing session
      await sdk.client.session.prompt({
        path: { id: selectedSessionID()! },
        body: { parts: [{ type: "text", text }] },
      })
      setInputText("")
    }
  }

  onMount(() => {
    sync.session.fetch(100)
    // Always start on MainScreen - user can select session from sessions panel
    // No auto-selection of previous sessions
  })

  return (
    <Show
      when={selectedSessionID()}
      fallback={<MainScreen onSubmit={handleSubmit} sessions={sessions()} onSelectSession={handleSelectSession} />}
    >
      <TerminalLayout
        sessions={sessions()}
        messages={messages()}
        todos={todos()}
        subagents={subagents()}
        selectedSessionId={selectedSessionID()}
        onSelectSession={handleSelectSession}
        inputText={inputText()}
        onInput={handleInput}
        onSubmit={handleSubmit}
        currentAgent={currentAgent()}
      />
    </Show>
  )
}
