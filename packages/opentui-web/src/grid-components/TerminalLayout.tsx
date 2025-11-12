import type { Component } from "solid-js"
import { createSignal, onMount, onCleanup, createEffect } from "solid-js"
import { SessionsPanel } from "./SessionsPanel"
import { MessagesPanel } from "./MessagesPanel"
import { SidebarPanel } from "./SidebarPanel"
import { GridDivider } from "./GridDivider"
import { CommandMenu } from "./CommandMenu"
import { ModelPicker, type Model } from "./ModelPicker"
import { useSDK } from "../context/sdk"
import { useBejazzle } from "../context/bejazzle"

interface TerminalLayoutProps {
  sessions: Array<{ id: string; title: string; hasChildren?: boolean; parentID?: string }>
  messages: Array<any>
  todos: Array<any>
  subagents: Array<{
    id: string
    title: string
    status: "running" | "completed" | "failed"
    time: { created: number; updated: number }
  }>
  files: Array<{ path: string; operation: string; messageID: string; partID: string }>
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  inputText: string
  onInput: (text: string) => void
  onSubmit?: (text: string) => void
  currentAgent: string
  projectPath?: string
}

export const TerminalLayout: Component<TerminalLayoutProps> = (props) => {
  console.log("[TerminalLayout] Rendering with todos:", props.todos, "length:", props.todos?.length)

  const sdk = useSDK()
  const bejazzle = useBejazzle()

  // Character width for Berkeley Mono at 16px
  const CHAR_WIDTH = 9.6

  // Toast notification state
  const [toastMessage, setToastMessage] = createSignal<string | null>(null)
  const [toastVisible, setToastVisible] = createSignal(false)
  let toastTimeout: number | undefined

  // Helper function to show toast with automatic cleanup
  const showToast = (message: string, duration = 2000) => {
    // Clear any existing timeout
    if (toastTimeout) {
      clearTimeout(toastTimeout)
    }
    setToastMessage(message)
    setToastVisible(true)
    toastTimeout = window.setTimeout(() => {
      setToastVisible(false)
    }, duration)
  }

  // Calculate total columns based on window width
  const calculateTotalColumns = () => Math.floor(window.innerWidth / CHAR_WIDTH)

  // Reactive total columns signal
  const [totalCols, setTotalCols] = createSignal(calculateTotalColumns())

  // Draggable column widths
  const [leftWidth, setLeftWidth] = createSignal(43)
  const [rightWidth, setRightWidth] = createSignal(50)

  // Panel collapse state
  const [leftCollapsed, setLeftCollapsed] = createSignal(false)
  const [rightCollapsed, setRightCollapsed] = createSignal(false)

  // Command menu state
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false)

  // Model picker state
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [currentModelId, setCurrentModelId] = createSignal<string | null>(null)
  const [availableModels, setAvailableModels] = createSignal<Model[]>([])
  const [defaultModels, setDefaultModels] = createSignal<Record<string, string>>({})

  const leftDividerCol = () => (leftCollapsed() ? 0 : leftWidth())
  const rightDividerCol = () => (rightCollapsed() ? totalCols() : totalCols() - rightWidth())

  // Check if current session is a subagent
  const currentSession = () => props.sessions.find((s) => s.id === props.selectedSessionId)
  const isSubagent = () => !!currentSession()?.parentID
  const parentSessionId = () => currentSession()?.parentID

  // Get sibling subagents for navigation
  const siblingSubagents = () => {
    const parent = parentSessionId()
    if (!parent) return []
    return props.sessions.filter((s) => s.parentID === parent).map((s) => ({ id: s.id, title: s.title }))
  }

  // Fetch available models from SDK
  onMount(async () => {
    try {
      const result = await sdk.client.config.providers()
      if (result.data) {
        const models: Model[] = []
        result.data.providers.forEach((provider: any) => {
          Object.entries(provider.models).forEach(([modelId, modelInfo]: [string, any]) => {
            models.push({
              id: modelId,
              name: modelInfo.name,
              provider: provider.name,
              description: modelInfo.experimental ? `${modelInfo.name} (experimental)` : undefined,
            })
          })
        })
        setAvailableModels(models)
        setDefaultModels(result.data.default)
      }
    } catch (error) {
      console.error("Failed to fetch models:", error)
    }
  })

  // Detect current model from latest assistant message
  createEffect(() => {
    const msgs = props.messages
    if (!msgs.length) return

    // Find the last assistant message with model info
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role === "assistant" && msg.model) {
        setCurrentModelId(msg.model)
        return
      }
    }
  })

  // Window resize listener and keyboard shortcuts
  onMount(() => {
    const handleResize = () => {
      setTotalCols(calculateTotalColumns())
    }

    window.addEventListener("resize", handleResize)

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P or Cmd+P - Open command menu
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault()
        setCommandMenuOpen(true)
      }
      // Ctrl+[ - Toggle left sidebar
      else if (e.ctrlKey && e.key === "[") {
        e.preventDefault()
        handleToggleLeftSidebar()
      }
      // Ctrl+] - Toggle right sidebar
      else if (e.ctrlKey && e.key === "]") {
        e.preventDefault()
        handleToggleRightSidebar()
      }
      // Ctrl+B - Toggle both sidebars
      else if (e.ctrlKey && e.key === "b") {
        e.preventDefault()
        handleToggleBothSidebars()
      }
      // Ctrl+Left - Previous subagent
      else if (e.ctrlKey && e.key === "ArrowLeft" && isSubagent()) {
        e.preventDefault()
        const siblings = siblingSubagents()
        const currentIndex = siblings.findIndex((s) => s.id === props.selectedSessionId)
        if (currentIndex > 0) {
          const prevSibling = siblings[currentIndex - 1]
          if (prevSibling) {
            props.onSelectSession(prevSibling.id)
          }
        }
      }
      // Ctrl+Right - Next subagent
      else if (e.ctrlKey && e.key === "ArrowRight" && isSubagent()) {
        e.preventDefault()
        const siblings = siblingSubagents()
        const currentIndex = siblings.findIndex((s) => s.id === props.selectedSessionId)
        if (currentIndex < siblings.length - 1) {
          const nextSibling = siblings[currentIndex + 1]
          if (nextSibling) {
            props.onSelectSession(nextSibling.id)
          }
        }
      }
      // Ctrl+X then J - Toggle Bejazzle Mode
      else if (e.ctrlKey && e.key === "x") {
        e.preventDefault()
        // Wait for next key
        const handleNextKey = (e2: KeyboardEvent) => {
          if (e2.key === "j" || e2.key === "J") {
            e2.preventDefault()
            handleToggleBejazzle()
          }
          window.removeEventListener("keydown", handleNextKey)
        }
        window.addEventListener("keydown", handleNextKey)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    // Text selection handler - auto copy to clipboard
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim()

      if (selectedText && selectedText.length > 0) {
        // Copy to clipboard
        navigator.clipboard.writeText(selectedText).then(() => {
          showToast(`Copied ${selectedText.length} characters`)
        })
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange)

    onCleanup(() => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("selectionchange", handleSelectionChange)
      // Clean up toast timeout
      if (toastTimeout) {
        clearTimeout(toastTimeout)
      }
    })
  })

  // Command handlers
  const handleNewSession = () => {
    console.log("New session requested")
    // TODO: Implement new session creation via SDK
  }

  const handleSwitchSession = () => {
    console.log("Switch session requested")
    // TODO: Open session list dialog
  }

  const handleSwitchModel = () => {
    console.log("Switch model requested")
    setModelPickerOpen(true)
  }

  const handleSelectModel = async (modelId: string) => {
    console.log("Selected model:", modelId)
    setCurrentModelId(modelId)
    // Note: Model is set per-message, not per-session
    // The next prompt will use the newly selected model via Config
  }

  const handleSwitchAgent = () => {
    console.log("Switch agent requested")
    // TODO: Open agent selection dialog
  }

  const handleToggleLeftSidebar = () => {
    setLeftCollapsed((prev) => !prev)
  }

  const handleToggleRightSidebar = () => {
    setRightCollapsed((prev) => !prev)
  }

  const handleToggleBothSidebars = () => {
    const bothCollapsed = leftCollapsed() && rightCollapsed()
    setLeftCollapsed(!bothCollapsed)
    setRightCollapsed(!bothCollapsed)
  }

  const handleToggleBejazzle = () => {
    const newMode = !bejazzle.bejazzleMode()
    bejazzle.setBejazzleMode(newMode)
    // Apply full theme preset when enabling, minimal when disabling
    bejazzle.applyPreset(newMode ? "full" : "minimal")
    showToast(newMode ? "🎨 Bejazzle Mode Enabled" : "Bejazzle Mode Disabled")
  }

  // Session command handlers
  const handleSessionTimeline = () => {
    showToast("📍 Session timeline - Coming soon")
  }

  const handleSessionCompact = () => {
    showToast("🗜️ Compact session - Coming soon")
  }

  const handleSessionExport = () => {
    showToast("📤 Export session - Coming soon")
  }

  const handleSessionShare = () => {
    showToast("🔗 Share session - Coming soon")
  }

  const handleSessionInterrupt = () => {
    showToast("⏸️ Interrupt session - Coming soon")
  }

  // Agent command handlers
  const handleModelCycle = () => {
    showToast("🔄 Cycle model - Coming soon")
  }

  const handleAgentCycle = () => {
    showToast("🔄 Cycle agent - Coming soon")
  }

  // Message command handlers
  const handleMessagesCopy = () => {
    showToast("📋 Copy message - Coming soon")
  }

  const handleMessagesUndo = () => {
    showToast("↩️ Undo message - Coming soon")
  }

  const handleMessagesRedo = () => {
    showToast("↪️ Redo message - Coming soon")
  }

  const handleToggleConceal = () => {
    showToast("👁️ Toggle code concealment - Coming soon")
  }

  // System command handlers
  const handleViewStatus = () => {
    showToast("📊 View status - Coming soon")
  }

  const handleSwitchTheme = () => {
    showToast("🎨 Switch theme - Coming soon")
  }

  const handleHelp = () => {
    showToast("❓ Help - Coming soon")
  }

  return (
    <div
      data-bejazzle={bejazzle.bejazzleMode() ? "true" : "false"}
      data-bejazzle-level={String(bejazzle.bejazzleLevel())}
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100vw",
        height: "100vh",
        background: "#000000",
        overflow: "hidden",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        display: "flex",
        "flex-direction": "column",
        /* GPU acceleration for smooth resizing */
        transform: "translateZ(0)",
        "will-change": "transform",
        "-webkit-backface-visibility": "hidden",
        "-webkit-perspective": "1000",
      }}
    >
      {/* Dividers - positioned absolutely to span full height including footer */}
      <GridDivider
        col={leftWidth()}
        minCol={46}
        maxCol={60}
        onDrag={(newCol) => setLeftWidth(newCol)}
        alwaysVisible={false}
        style={{ position: "fixed", height: "100vh" }}
      />
      <GridDivider
        col={totalCols() - rightWidth() + 6}
        minCol={totalCols() - 60}
        maxCol={totalCols() - 40}
        onDrag={(newCol) => setRightWidth(Math.max(40, totalCols() - newCol + 6))}
        alwaysVisible={false}
        style={{ position: "fixed", height: "100vh" }}
        class="divider-second"
      />

      {/* Main content area - grows to fill space */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        {/* Left Panel - Sessions (only show if not collapsed) */}
        {!leftCollapsed() && (
          <SessionsPanel
            sessions={props.sessions}
            selectedId={props.selectedSessionId}
            onSelect={props.onSelectSession}
            onCollapse={() => setLeftCollapsed(true)}
            width={leftWidth()}
          />
        )}

        {/* Show expand arrow if left panel is collapsed */}
        {leftCollapsed() && (
          <div
            onClick={() => setLeftCollapsed(false)}
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              width: "2ch",
              height: "1.2em",
              background: "#1a1a1a",
              color: "#858585",
              cursor: "pointer",
              "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
              "font-size": "16px",
            }}
          >
            ▶
          </div>
        )}

        {/* Center Panel - Messages */}
        <MessagesPanel
          col={leftWidth()}
          width={totalCols() - leftWidth() - (rightCollapsed() ? 0 : rightWidth())}
          messages={props.messages}
          inputText={props.inputText}
          onInput={props.onInput}
          onSubmit={props.onSubmit}
          parentSessionId={parentSessionId()}
          currentSessionId={props.selectedSessionId || undefined}
          siblingSubagents={siblingSubagents()}
          onNavigate={props.onSelectSession}
          projectPath={props.projectPath}
          currentModel={availableModels().find((m) => m.id === currentModelId())?.name}
          onModelClick={handleSwitchModel}
        />

        {/* Right Panel - Sidebar (only show if not collapsed) */}
        {!rightCollapsed() && (
          <SidebarPanel
            col={totalCols() - rightWidth()}
            width={rightWidth()}
            todos={props.todos}
            subagents={props.subagents}
            files={props.files}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}

        {/* Show expand arrow if right panel is collapsed */}
        {rightCollapsed() && (
          <div
            onClick={() => setRightCollapsed(false)}
            style={{
              position: "absolute",
              right: "0",
              top: "0",
              width: "2ch",
              height: "1.2em",
              background: "#1a1a1a",
              color: "#858585",
              cursor: "pointer",
              "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
              "font-size": "16px",
              "text-align": "right",
            }}
          >
            ◀
          </div>
        )}
      </div>

      {/* Bottom Bar - fixed height footer */}
      <div style={{ "flex-shrink": "0" }}>
        {/* Footer - single line - PURE BLACK */}
        <div
          style={{
            height: "2.4em",
            background: "#000000",
            color: "#858585",
            padding: "0 1ch",
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
            "font-size": "16px",
          }}
        >
          <span>
            <span style={{ color: "#ffffff" }}>code</span>surf v0.0.0-dev-codesurf-202511101344{" "}
            ~/Documents/GitHub/flows/opencode-stt
          </span>
          <span>
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> commands{" "}
            <span style={{ color: "#ffffff", "font-weight": "bold" }}>tab</span>{" "}
            <span style={{ color: "#61afef" }}>{props.currentAgent}</span>
          </span>
        </div>
      </div>

      {/* Command Menu */}
      <CommandMenu
        isOpen={commandMenuOpen()}
        onClose={() => setCommandMenuOpen(false)}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
        onSwitchModel={handleSwitchModel}
        onSwitchAgent={handleSwitchAgent}
        onToggleLeftSidebar={handleToggleLeftSidebar}
        onToggleRightSidebar={handleToggleRightSidebar}
        onToggleBothSidebars={handleToggleBothSidebars}
        onToggleBejazzle={handleToggleBejazzle}
      />

      {/* Model Picker */}
      <ModelPicker
        isOpen={modelPickerOpen()}
        models={availableModels()}
        currentModelId={currentModelId() || undefined}
        onSelect={handleSelectModel}
        onClose={() => setModelPickerOpen(false)}
      />
    </div>
  )
}
