/**
 * File Activity Context
 *
 * Tracks AI file operations (read, edit, create) for highlighting in the file explorer.
 * Feature: 003-file-activity-highlight
 */

import { createStore, produce, reconcile } from "solid-js/store"
import { createMemo, createEffect, createRoot, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { Persist, persisted } from "@/utils/persist"
import { base64Decode } from "@opencode-ai/util/encode"
import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import {
  type FileActivityType,
  type FileActivityState,
  type FileActivityStore,
  TOOL_ACTIVITY_MAP,
  ACTIVITY_PRECEDENCE,
} from "@/types/file-activity"

// Event types for file activity changes
export type FileActivityEvent = {
  type: "activity"
  path: string
  activityType: FileActivityType
  isNew: boolean // true if this is a new file (created)
}

// Persisted store type (just the files map, no sessionId needed)
type PersistedFileActivity = {
  files: Record<string, FileActivityState>
}

// =============================================================================
// Session-scoped file activity store
// =============================================================================

const MAX_ACTIVITY_SESSIONS = 20

type ActivitySession = ReturnType<typeof createActivitySession>

type ActivityCacheEntry = {
  value: ActivitySession
  dispose: VoidFunction
}

function createActivitySession(dir: string, sessionId: string | undefined) {
  // Persist activity per session
  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, sessionId, "file-activity"),
    createStore<PersistedFileActivity>({
      files: {},
    })
  )

  // Subscribers for file activity events (not persisted)
  const subscribers = new Set<(event: FileActivityEvent) => void>()

  // Emit event to all subscribers
  function emitEvent(event: FileActivityEvent) {
    for (const subscriber of subscribers) {
      try {
        subscriber(event)
      } catch (e) {
        console.error("[FileActivity] Subscriber error:", e)
      }
    }
  }

  // Record activity with precedence logic
  function recordActivity(
    path: string,
    type: FileActivityType,
    messageId: string,
    toolCallId: string
  ) {
    const existing = store.files[path]
    const isNew = type === "created"

    // Check precedence - don't downgrade
    if (existing && ACTIVITY_PRECEDENCE[existing.type] >= ACTIVITY_PRECEDENCE[type]) {
      // Just add the tool call ID to existing entry
      setStore(
        "files",
        path,
        produce((draft) => {
          if (!draft.toolCalls) draft.toolCalls = []
          if (!draft.toolCalls.includes(toolCallId)) {
            draft.toolCalls.push(toolCallId)
          }
        })
      )
      // Still emit event for read operations so preview can refresh
      if (type === "read" || type === "edited") {
        emitEvent({ type: "activity", path, activityType: type, isNew: false })
      }
      return
    }

    // Create or upgrade the activity
    setStore("files", path, {
      type,
      timestamp: Date.now(),
      messageId,
      toolCalls: existing?.toolCalls ? [...existing.toolCalls, toolCallId] : [toolCallId],
    })

    // Emit event for subscribers (file tree refresh, preview refresh, etc.)
    emitEvent({ type: "activity", path, activityType: type, isNew })
  }

  // Get aggregated directory activity
  function getDirectoryActivity(directoryPath: string): FileActivityType | undefined {
    const prefix = directoryPath === "" ? "" : directoryPath + "/"
    let highestPrecedence = 0
    let result: FileActivityType | undefined

    for (const [path, activity] of Object.entries(store.files)) {
      if (path.startsWith(prefix) && path !== directoryPath) {
        const precedence = ACTIVITY_PRECEDENCE[activity.type]
        if (precedence > highestPrecedence) {
          highestPrecedence = precedence
          result = activity.type
        }
      }
    }

    return result
  }

  return {
    ready,
    store,
    setStore,
    subscribers,
    emitEvent,
    recordActivity,
    getDirectoryActivity,
  }
}

// =============================================================================
// T005-T013: FileActivity Context Implementation
// =============================================================================

export const { use: useFileActivity, provider: FileActivityProvider } = createSimpleContext({
  name: "FileActivity",
  gate: false, // Don't wait for ready state
  init: () => {
    const sdk = useSDK()
    const params = useParams()

    // Cache of activity sessions per directory/session
    const cache = new Map<string, ActivityCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_ACTIVITY_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const load = (dir: string, sessionId: string | undefined) => {
      const key = `${dir}:${sessionId ?? "__workspace__"}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createActivitySession(dir, sessionId),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    // Get the current session based on route params
    const currentSession = createMemo(() => {
      const dir = params.dir ? base64Decode(params.dir) : sdk.directory
      return load(dir, params.id)
    })

    // T008: Extract file path from ToolPart.state.input
    function extractFilePath(part: ToolPart): string | undefined {
      if (part.state.status === "pending") return undefined
      const input = part.state.input
      // Try common path field names (both camelCase and snake_case)
      return (input?.filePath as string) ?? (input?.file_path as string) ?? (input?.path as string) ?? undefined
    }

    // T007: Subscribe to message.part.updated events
    // This handles real-time updates during the session
    const unsub = sdk.event.on("message.part.updated", (event) => {
      const part = event.properties.part

      // Only process completed tool parts
      if (part.type !== "tool") return
      if (part.state.status !== "completed") return

      const toolPart = part as ToolPart

      // Get the activity type for this tool
      const activityAction = TOOL_ACTIVITY_MAP[toolPart.tool]
      if (!activityAction) return

      // Extract file path
      const filePath = extractFilePath(toolPart)
      if (!filePath) return

      // Get the session for this tool's session ID
      // Note: We use the route's session for persistence, but the tool event
      // tells us which session it belongs to
      const session = currentSession()

      // Determine the activity type
      let activityType: FileActivityType

      if (activityAction === "read") {
        activityType = "read"
      } else if (activityAction === "edit") {
        activityType = "edited"
      } else if (activityAction === "write") {
        // Check if file already has activity (existed before)
        const existingActivity = session.store.files[filePath]
        if (existingActivity) {
          activityType = "edited"
        } else {
          activityType = "created"
        }
      } else {
        return
      }

      // Record the activity to the current session
      session.recordActivity(filePath, activityType, toolPart.messageID, toolPart.callID)
    })

    onCleanup(unsub)

    // =============================================================================
    // T011-T013: Public API
    // =============================================================================

    return {
      // T011: Get activity state for a file
      get(path: string): FileActivityState | undefined {
        return currentSession().store.files[path]
      },

      // T012: Check if file has activity
      has(path: string): boolean {
        return path in currentSession().store.files
      },

      // T029: Get aggregated directory activity
      getDirectoryActivity(directoryPath: string): FileActivityType | undefined {
        return currentSession().getDirectoryActivity(directoryPath)
      },

      // Get all files with a specific activity type
      getByType(type: FileActivityType): string[] {
        const session = currentSession()
        return Object.entries(session.store.files)
          .filter(([_, activity]) => activity.type === type)
          .map(([path]) => path)
      },

      // Get all file paths with activity
      getAllPaths(): string[] {
        return Object.keys(currentSession().store.files)
      },

      // Get current session ID from route
      getSessionId(): string | undefined {
        return params.id
      },

      // T034: Clear all activity for current session
      clear() {
        currentSession().setStore("files", {})
      },

      // T037: Remove activity for a specific file (e.g., when file is deleted)
      remove(path: string) {
        currentSession().setStore("files", path, undefined!)
      },

      // T038: Rename activity from one path to another (e.g., when file is moved)
      rename(oldPath: string, newPath: string) {
        const session = currentSession()
        const activity = session.store.files[oldPath]
        if (activity) {
          session.setStore("files", newPath, activity)
          session.setStore("files", oldPath, undefined!)
        }
      },

      // Subscribe to file activity events (for triggering refreshes)
      subscribe(callback: (event: FileActivityEvent) => void): () => void {
        const session = currentSession()
        session.subscribers.add(callback)
        return () => session.subscribers.delete(callback)
      },

      // Internal: record activity (exposed for testing)
      _recordActivity: (path: string, type: FileActivityType, messageId: string, toolCallId: string) => {
        currentSession().recordActivity(path, type, messageId, toolCallId)
      },
    }
  },
})
