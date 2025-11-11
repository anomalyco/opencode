import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup } from "solid-js"
import { TerminalLayout } from "../grid-components"
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
    const result: Array<{ id: string; title: string; hasChildren?: boolean; parentID?: string }> = []

    // First add parent sessions
    allSessions
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .forEach((parent) => {
        result.push({
          id: parent.id,
          title: parent.title,
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
    if (!selectedSessionID()) return "general"
    const session = sync.session.get(selectedSessionID()!)
    return session?.agentID || "general"
  }

  const handleSelectSession = (id: string) => {
    setSelectedSessionID(id)
    sync.session.sync(id)
  }

  const handleInput = (text: string) => {
    setInputText(text)
  }

  const handleSubmit = async (text: string) => {
    if (text.trim() && selectedSessionID()) {
      await sdk.client.session.prompt({
        path: { id: selectedSessionID()! },
        body: { parts: [{ type: "text", text }] },
      })
      setInputText("")
    }
  }

  onMount(() => {
    sync.session.fetch(100)

    setTimeout(() => {
      const allSessions = sync.data.session.filter((s) => !s.parentID).sort((a, b) => b.time.updated - a.time.updated)
      const firstSession = allSessions[0]
      if (firstSession) {
        setSelectedSessionID(firstSession.id)
        sync.session.sync(firstSession.id)
      }
    }, 500)
  })

  return (
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
  )
}
