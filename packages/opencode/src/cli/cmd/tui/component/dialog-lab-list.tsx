import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"

import { useToast } from "../ui/toast"


/**
 * Lab configuration - the four canonical labs in Conatus
 */
export interface Lab {
  id: string
  name: string
  icon: string
  description: string
  color: "primary" | "secondary" | "accent" | "success" | "warning" | "error"
}

export const LABS: Lab[] = [
  {
    id: "bootstrap",
    name: "Bootstrap",
    icon: "\u26a1",
    description: "Core infrastructure and initialization",
    color: "warning",
  },
  {
    id: "the-study-lab",
    name: "The Study",
    icon: "\ud83d\udcda",
    description: "Research, analysis, and knowledge synthesis",
    color: "primary",
  },
  {
    id: "the-teach-lab",
    name: "The Teach",
    icon: "\ud83c\udf93",
    description: "Documentation, tutorials, and knowledge transfer",
    color: "success",
  },
  {
    id: "the-govern-lab",
    name: "The Govern",
    icon: "\u2696\ufe0f",
    description: "Policy, governance, and system oversight",
    color: "accent",
  },
]

/**
 * Find an existing session for a lab by matching title
 */
function findLabSession(sessions: any[], lab: Lab) {
  return sessions.find((s) => {
    if (s.parentID) return false // Skip child sessions
    const title = s.title?.toLowerCase() || ""
    return title.includes(lab.id.toLowerCase()) || title.includes(lab.name.toLowerCase())
  })
}

/**
 * Dialog for selecting and switching between labs
 * 
 * Each lab has a persistent session - selecting a lab either:
 * 1. Navigates to the existing session for that lab
 * 2. Creates a new session with the lab's title
 */
export function DialogLabList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()

  const [switching, setSwitching] = createSignal<string | null>(null)

  // Get current session to mark as active
  const currentSessionID = createMemo(() => 
    route.data.type === "session" ? route.data.sessionID : undefined
  )

  // Find which lab the current session belongs to (if any)
  const currentLab = createMemo(() => {
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    const session = sync.session.get(sessionID)
    if (!session) return undefined
    
    for (const lab of LABS) {
      const title = session.title?.toLowerCase() || ""
      if (title.includes(lab.id.toLowerCase()) || title.includes(lab.name.toLowerCase())) {
        return lab.id
      }
    }
    return undefined
  })

  // Build options for each lab
  const options = createMemo(() => {
    const activeLabs: (DialogSelectOption<string> & { _session?: any; _lab: Lab })[] = []
    const availableLabs: (DialogSelectOption<string> & { _session?: any; _lab: Lab })[] = []

    for (const lab of LABS) {
      const existingSession = findLabSession(sync.data.session, lab)
      const isActive = currentLab() === lab.id
      const isBusy = existingSession && sync.data.session_status?.[existingSession.id]?.type === "busy"
      const isRetrying = existingSession && sync.data.session_status?.[existingSession.id]?.type === "retry"
      
      const option = {
        title: `${lab.icon} ${lab.name}`,
        value: lab.id,
        description: lab.description,
        category: existingSession ? "Active Labs" : "Available Labs",
        footer: existingSession 
          ? (isBusy ? "working..." : isRetrying ? "retrying..." : "ready")
          : "new",
        gutter: isActive ? (
          <text fg={theme[lab.color]}>{"\u25cf"}</text>
        ) : switching() === lab.id ? (
          <text fg={theme.primary}>{"\u25cb"}</text>
        ) : existingSession ? (
          <text fg={theme.textMuted}>{"\u25cb"}</text>
        ) : undefined,
        _session: existingSession,
        _lab: lab,
      } as DialogSelectOption<string> & { _session?: any; _lab: Lab }

      if (existingSession) {
        activeLabs.push(option)
      } else {
        availableLabs.push(option)
      }
    }

    // Show active labs first, then available labs
    return [...activeLabs, ...availableLabs]
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  const handleSelect = async (option: DialogSelectOption<string> & { _session?: any; _lab: Lab }) => {
    const lab = option._lab
    const existingSession = option._session

    if (existingSession) {
      // Navigate to existing session
      route.navigate({
        type: "session",
        sessionID: existingSession.id,
      })
      dialog.clear()
      toast.show({
        message: `Switched to ${lab.name}`,
        variant: "success",
        duration: 2000,
      })
    } else {
      // Create new session for this lab
      setSwitching(lab.id)
      try {
        const result = await sdk.client.session.create({
          title: `${lab.icon} ${lab.name}`,
        })
        if (result.data) {
          route.navigate({
            type: "session",
            sessionID: result.data.id,
          })
          toast.show({
            message: `Created ${lab.name} session`,
            variant: "success",
            duration: 2000,
          })
        }
        dialog.clear()
      } catch (error) {
        console.error("Failed to create lab session:", error)
        setSwitching(null)
        toast.show({
          message: `Failed to create ${lab.name} session`,
          variant: "error",
          duration: 3000,
        })
      }
    }
  }

  return (
    <DialogSelect
      title="Switch Lab"
      placeholder="Search labs..."
      options={options()}
      current={currentLab()}
      onSelect={handleSelect}
    />
  )
}
