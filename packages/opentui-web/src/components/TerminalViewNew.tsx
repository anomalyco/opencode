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
  const [projectPath, setProjectPath] = createSignal<string>(".")

  const sessions = () => {
    // Get all sessions (parents and children)
    const allSessions = sync.data.session

    // Build session tree
    const result: Array<{ id: string; title: string; timestamp?: number; hasChildren?: boolean; parentID?: string }> =
      []
    const seen = new Set<string>()

    // First add parent sessions
    allSessions
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
      .forEach((parent) => {
        if (!seen.has(parent.id)) {
          seen.add(parent.id)
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
            if (!seen.has(child.id)) {
              seen.add(child.id)
              result.push({
                id: child.id,
                title: child.title,
                timestamp: child.time.updated,
                parentID: parent.id,
                hasChildren: false,
              })
            }
          })
        }
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
      agent: msg.role === "assistant" ? (msg as any).mode : undefined,
      model: msg.role === "assistant" ? (msg as any).modelID : undefined,
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

  const files = () => {
    if (!selectedSessionID()) return []
    const msgs = messages()
    const fileOps: Array<{ path: string; operation: string; messageID: string; partID: string }> = []
    const seen = new Set<string>()

    // Extract file operations from tool use parts
    msgs.forEach((msg) => {
      msg.parts.forEach((part) => {
        if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "running")) {
          let filePath: string | undefined
          let operation: string | undefined

          // Check tool type and extract filePath
          if (part.tool === "read" || part.tool === "cc_read") {
            filePath = part.state.input.filePath as string
            operation = "read"
          } else if (part.tool === "edit" || part.tool === "cc_edit") {
            filePath = part.state.input.filePath as string
            operation = "edit"
          } else if (part.tool === "write" || part.tool === "cc_write") {
            filePath = part.state.input.filePath as string
            operation = "write"
          }

          // Add to list if we found a file operation
          if (filePath && !seen.has(filePath)) {
            seen.add(filePath)
            fileOps.push({
              path: filePath,
              operation: operation!,
              messageID: msg.id,
              partID: part.id,
            })
          }
        }
      })
    })

    return fileOps
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

  onMount(async () => {
    sync.session.fetch(100)
    // Fetch project path
    try {
      const pathResult = await sdk.client.path.get()
      if (pathResult.data) {
        setProjectPath(pathResult.data.directory || ".")
      }
    } catch (error) {
      console.error("Failed to fetch project path:", error)
    }
    // Always start on MainScreen - user can select session from sessions panel
    // No auto-selection of previous sessions
  })

  return (
    <Show
      when={selectedSessionID()}
      fallback={
        <MainScreen
          onSubmit={handleSubmit}
          sessions={sessions()}
          onSelectSession={handleSelectSession}
          projectPath={projectPath()}
        />
      }
    >
      <TerminalLayout
        sessions={sessions()}
        messages={messages()}
        todos={todos()}
        subagents={subagents()}
        files={files()}
        selectedSessionId={selectedSessionID()}
        onSelectSession={handleSelectSession}
        inputText={inputText()}
        onInput={handleInput}
        onSubmit={handleSubmit}
        currentAgent={currentAgent()}
        projectPath={projectPath()}
      />
    </Show>
  )
}
