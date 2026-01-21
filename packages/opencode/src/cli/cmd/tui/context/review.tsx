import { createContext, createEffect, on, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useKV } from "./kv"
import { useSync } from "./sync"
import type { Snapshot } from "@/snapshot"
import {
  generateFeedbackMessage as generateMessage,
  allReviewed as checkAllReviewed,
  getPendingCount as countPending,
  clampIndex,
  type ReviewStatus,
  type FileReview,
  type ReviewItem,
} from "../util/review"

export type { ReviewStatus, FileReview, ReviewItem }

export interface ReviewState {
  // Map of sessionID -> Map of filePath -> FileReview
  reviews: Record<string, Record<string, FileReview>>
  // Current view mode (hidden or visible - always fullscreen when visible)
  viewMode: "hidden" | "visible"
  // Currently selected file index per session for keyboard navigation
  selectedIndices: Record<string, number>
}

const KV_KEY = "review_state"

function init() {
  const sync = useSync()
  const kv = useKV()

  // Load persisted reviews from KV store
  const persistedReviews = kv.get(KV_KEY, {}) as Record<string, Record<string, FileReview>>

  const [store, setStore] = createStore<ReviewState>({
    reviews: persistedReviews,
    viewMode: "hidden",
    selectedIndices: {},
  })

  // Persist reviews to KV store whenever they change
  createEffect(
    on(
      () => JSON.stringify(store.reviews),
      () => {
        kv.set(KV_KEY, store.reviews)
      },
      { defer: true },
    ),
  )

  // Get the diffs for a session
  const getDiffs = (sessionID: string): Snapshot.FileDiff[] => {
    return sync.data.session_diff[sessionID] ?? []
  }

  // Get review status for a file
  const getReview = (sessionID: string, file: string): FileReview | undefined => {
    return store.reviews[sessionID]?.[file]
  }

  // Get all file reviews for a session, combining diffs with review status
  const getSessionReviews = (sessionID: string) => {
    const diffs = getDiffs(sessionID)
    return diffs.map((diff) => ({
      diff,
      review: getReview(sessionID, diff.file) ?? {
        file: diff.file,
        status: "pending" as ReviewStatus,
      },
    }))
  }

  // Count of pending reviews
  const getPendingCount = (sessionID: string): number => {
    return countPending(getSessionReviews(sessionID))
  }

  // Check if there are any reviews to process
  const hasReviews = (sessionID: string): boolean => {
    return getDiffs(sessionID).length > 0
  }

  // Check if all reviews have been processed (non-pending)
  const allReviewed = (sessionID: string): boolean => {
    return checkAllReviewed(getSessionReviews(sessionID))
  }

  // Get selected index for a session, bounded to valid range
  const getSelectedIndex = (sessionID: string): number => {
    const idx = store.selectedIndices[sessionID] ?? 0
    return clampIndex(idx, getDiffs(sessionID).length)
  }

  const result = {
    get state() {
      return store
    },

    get viewMode() {
      return store.viewMode
    },

    getDiffs,
    getReview,
    getSessionReviews,
    getPendingCount,
    hasReviews,
    allReviewed,
    getSelectedIndex,

    // Set review status for a file
    setStatus(sessionID: string, file: string, status: ReviewStatus) {
      if (!store.reviews[sessionID]) {
        setStore("reviews", sessionID, {})
      }
      setStore("reviews", sessionID, file, {
        file,
        status,
        feedback: store.reviews[sessionID]?.[file]?.feedback,
      })
    },

    // Set feedback for a file (keeps current status)
    setFeedback(sessionID: string, file: string, feedback: string) {
      if (!store.reviews[sessionID]) {
        setStore("reviews", sessionID, {})
      }
      const currentStatus = store.reviews[sessionID]?.[file]?.status ?? "pending"
      setStore("reviews", sessionID, file, {
        file,
        status: currentStatus,
        feedback,
      })
    },

    // Reject with optional feedback
    rejectWithFeedback(sessionID: string, file: string, feedback?: string) {
      if (!store.reviews[sessionID]) {
        setStore("reviews", sessionID, {})
      }
      setStore("reviews", sessionID, file, {
        file,
        status: "rejected",
        feedback,
      })
    },

    // Toggle view mode (binary: hidden ↔ visible)
    toggleView() {
      if (store.viewMode === "hidden") {
        setStore("viewMode", "visible")
      } else {
        setStore("viewMode", "hidden")
      }
    },

    // Set view mode directly
    setViewMode(mode: ReviewState["viewMode"]) {
      setStore("viewMode", mode)
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

    // Select file by index for a session
    selectIndex(sessionID: string, index: number) {
      setStore("selectedIndices", sessionID, index)
    },

    // Navigate to next file
    selectNext(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const currentIdx = getSelectedIndex(sessionID)
      setStore("selectedIndices", sessionID, Math.min(currentIdx + 1, diffs.length - 1))
    },

    // Navigate to previous file
    selectPrev(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const currentIdx = getSelectedIndex(sessionID)
      setStore("selectedIndices", sessionID, Math.max(currentIdx - 1, 0))
    },

    // Approve current selection
    approveCurrent(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const idx = getSelectedIndex(sessionID)
      const file = diffs[idx]?.file
      if (file) {
        result.setStatus(sessionID, file, "approved")
      }
    },

    // Reject current selection
    rejectCurrent(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const idx = getSelectedIndex(sessionID)
      const file = diffs[idx]?.file
      if (file) {
        result.setStatus(sessionID, file, "rejected")
      }
    },

    // Reset current selection to pending
    resetCurrent(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const idx = getSelectedIndex(sessionID)
      const file = diffs[idx]?.file
      if (file) {
        result.setStatus(sessionID, file, "pending")
        // Clear any feedback when resetting
        if (store.reviews[sessionID]?.[file]) {
          setStore("reviews", sessionID, file, "feedback", undefined)
        }
      }
    },

    // Approve all files
    approveAll(sessionID: string) {
      const diffs = getDiffs(sessionID)
      for (const diff of diffs) {
        result.setStatus(sessionID, diff.file, "approved")
      }
    },

    // Approve current and advance to next pending file
    approveAndAdvance(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const idx = getSelectedIndex(sessionID)
      const file = diffs[idx]?.file
      if (file) {
        result.setStatus(sessionID, file, "approved")
        result.advanceToNextPending(sessionID)
      }
    },

    // Reject current and advance to next pending file
    rejectAndAdvance(sessionID: string, feedback?: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const idx = getSelectedIndex(sessionID)
      const file = diffs[idx]?.file
      if (file) {
        result.rejectWithFeedback(sessionID, file, feedback)
        result.advanceToNextPending(sessionID)
      }
    },

    // Advance to next pending file (or stay if none)
    advanceToNextPending(sessionID: string) {
      const diffs = getDiffs(sessionID)
      if (diffs.length === 0) return
      const currentIdx = getSelectedIndex(sessionID)

      // Look for next pending file after current
      for (let i = currentIdx + 1; i < diffs.length; i++) {
        const file = diffs[i]?.file
        if (file && (store.reviews[sessionID]?.[file]?.status ?? "pending") === "pending") {
          setStore("selectedIndices", sessionID, i)
          return
        }
      }

      // Look for pending file before current
      for (let i = 0; i < currentIdx; i++) {
        const file = diffs[i]?.file
        if (file && (store.reviews[sessionID]?.[file]?.status ?? "pending") === "pending") {
          setStore("selectedIndices", sessionID, i)
          return
        }
      }

      // No pending files, just advance to next if possible
      if (currentIdx < diffs.length - 1) {
        setStore("selectedIndices", sessionID, currentIdx + 1)
      }
    },

    // Clear all reviews for a session
    clearSession(sessionID: string) {
      setStore("reviews", sessionID, {})
      setStore("selectedIndices", sessionID, 0)
    },

    // Generate feedback message to send to agent
    generateFeedbackMessage(sessionID: string): string | null {
      return generateMessage(getSessionReviews(sessionID))
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
