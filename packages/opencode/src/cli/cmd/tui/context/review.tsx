import { createContext, createEffect, on, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useKV } from "./kv"
import { useSync } from "./sync"
import type { Snapshot } from "@/snapshot"
import {
  generateFeedbackMessage as generateMessage,
  getChanges as parseChanges,
  clampIndex,
  type ReviewComment,
  type Change,
} from "../util/review"

export type { ReviewComment, Change }

export interface ReviewState {
  // Map of sessionID -> file -> changeId -> comments[]
  comments: Record<string, Record<string, Record<string, ReviewComment[]>>>
  // Current view mode (hidden or visible)
  viewMode: "hidden" | "visible"
  // Expanded files per session
  openFiles: Record<string, string[]>
  // Selected change per session for keyboard navigation
  selectedChange: Record<string, { file: string; changeId: string } | null>
}

const KV_KEY = "review_comments"

function init() {
  const sync = useSync()
  const kv = useKV()

  // Load persisted comments from KV store
  const persisted = kv.get(KV_KEY, {}) as Record<string, Record<string, Record<string, ReviewComment[]>>>

  const [store, setStore] = createStore<ReviewState>({
    comments: persisted,
    viewMode: "hidden",
    openFiles: {},
    selectedChange: {},
  })

  // Persist comments to KV store whenever they change
  createEffect(
    on(
      () => JSON.stringify(store.comments),
      () => {
        kv.set(KV_KEY, store.comments)
      },
      { defer: true },
    ),
  )

  // Get the diffs for a session
  const getDiffs = (sessionID: string): Snapshot.FileDiff[] => {
    return sync.data.session_diff[sessionID] ?? []
  }

  // Get changes (hunks) for a file
  const getChanges = (diff: Snapshot.FileDiff): Change[] => {
    return parseChanges(diff)
  }

  // Get all changes for a session
  const getAllChanges = (sessionID: string): Change[] => {
    const diffs = getDiffs(sessionID)
    return diffs.flatMap((diff) => getChanges(diff))
  }

  // Get comments for a specific change
  const getComments = (sessionID: string, file: string, changeId: string): ReviewComment[] => {
    return store.comments[sessionID]?.[file]?.[changeId] ?? []
  }

  // Get all comments for a file
  const getFileComments = (sessionID: string, file: string): Record<string, ReviewComment[]> => {
    return store.comments[sessionID]?.[file] ?? {}
  }

  // Get comment count for a session
  const getCommentCount = (sessionID: string): number => {
    const sessionComments = store.comments[sessionID]
    if (!sessionComments) return 0
    let count = 0
    for (const file of Object.keys(sessionComments)) {
      for (const changeId of Object.keys(sessionComments[file])) {
        count += sessionComments[file][changeId].length
      }
    }
    return count
  }

  // Check if there are diffs to review
  const hasReviews = (sessionID: string): boolean => {
    return getDiffs(sessionID).length > 0
  }

  // Get open files for a session
  const getOpenFiles = (sessionID: string): string[] => {
    return store.openFiles[sessionID] ?? []
  }

  // Get selected change for a session
  const getSelectedChange = (sessionID: string): { file: string; changeId: string } | null => {
    return store.selectedChange[sessionID] ?? null
  }

  const result = {
    get state() {
      return store
    },

    get viewMode() {
      return store.viewMode
    },

    getDiffs,
    getChanges,
    getAllChanges,
    getComments,
    getFileComments,
    getCommentCount,
    hasReviews,
    getOpenFiles,
    getSelectedChange,

    // Add a comment to a change
    addComment(sessionID: string, file: string, changeId: string, text: string) {
      if (!store.comments[sessionID]) {
        setStore("comments", sessionID, {})
      }
      if (!store.comments[sessionID][file]) {
        setStore("comments", sessionID, file, {})
      }
      if (!store.comments[sessionID][file][changeId]) {
        setStore("comments", sessionID, file, changeId, [])
      }
      const comment: ReviewComment = {
        id: crypto.randomUUID(),
        text,
        createdAt: Date.now(),
      }
      setStore("comments", sessionID, file, changeId, (prev) => [...prev, comment])
    },

    // Remove a comment
    removeComment(sessionID: string, file: string, changeId: string, commentId: string) {
      if (!store.comments[sessionID]?.[file]?.[changeId]) return
      setStore("comments", sessionID, file, changeId, (prev) => prev.filter((c) => c.id !== commentId))
    },

    // Toggle view mode (hidden ↔ visible)
    toggleView() {
      setStore("viewMode", store.viewMode === "hidden" ? "visible" : "hidden")
    },

    // Show review panel
    show() {
      if (store.viewMode === "hidden") {
        setStore("viewMode", "visible")
      }
    },

    // Hide review panel
    hide() {
      setStore("viewMode", "hidden")
    },

    // Toggle file open/close in accordion
    toggleFile(sessionID: string, file: string) {
      const current = store.openFiles[sessionID] ?? []
      if (current.includes(file)) {
        setStore(
          "openFiles",
          sessionID,
          current.filter((f) => f !== file),
        )
      } else {
        setStore("openFiles", sessionID, [...current, file])
      }
    },

    // Set open files for a session
    setOpenFiles(sessionID: string, files: string[]) {
      setStore("openFiles", sessionID, files)
    },

    // Expand all files
    expandAll(sessionID: string) {
      const diffs = getDiffs(sessionID)
      setStore(
        "openFiles",
        sessionID,
        diffs.map((d) => d.file),
      )
    },

    // Collapse all files
    collapseAll(sessionID: string) {
      setStore("openFiles", sessionID, [])
    },

    // Select a change for keyboard navigation
    selectChange(sessionID: string, file: string, changeId: string) {
      setStore("selectedChange", sessionID, { file, changeId })
    },

    // Clear selection
    clearSelection(sessionID: string) {
      setStore("selectedChange", sessionID, null)
    },

    // Navigate to next change
    selectNextChange(sessionID: string) {
      const changes = getAllChanges(sessionID)
      if (changes.length === 0) return

      const current = getSelectedChange(sessionID)
      if (!current) {
        const first = changes[0]
        setStore("selectedChange", sessionID, { file: first.file, changeId: first.id })
        return
      }

      const idx = changes.findIndex((c) => c.id === current.changeId)
      const nextIdx = clampIndex(idx + 1, changes.length)
      const next = changes[nextIdx]
      setStore("selectedChange", sessionID, { file: next.file, changeId: next.id })
    },

    // Navigate to previous change
    selectPrevChange(sessionID: string) {
      const changes = getAllChanges(sessionID)
      if (changes.length === 0) return

      const current = getSelectedChange(sessionID)
      if (!current) {
        const last = changes[changes.length - 1]
        setStore("selectedChange", sessionID, { file: last.file, changeId: last.id })
        return
      }

      const idx = changes.findIndex((c) => c.id === current.changeId)
      const prevIdx = clampIndex(idx - 1, changes.length)
      const prev = changes[prevIdx]
      setStore("selectedChange", sessionID, { file: prev.file, changeId: prev.id })
    },

    // Clear all comments for a session
    clearSession(sessionID: string) {
      setStore("comments", sessionID, {})
      setStore("openFiles", sessionID, [])
      setStore("selectedChange", sessionID, null)
    },

    // Generate feedback message from comments
    generateFeedbackMessage(sessionID: string): string | null {
      const diffs = getDiffs(sessionID)
      const sessionComments = store.comments[sessionID] ?? {}
      return generateMessage(diffs, sessionComments)
    },
  }

  return result
}

export type ReviewContext = ReturnType<typeof init>

const ctx = createContext<ReviewContext>()

export function ReviewProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useReview() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useReview must be used within a ReviewProvider")
  }
  return value
}
