/**
 * DB interface type — implemented by packages/opencode/src/collab/db.ts using
 * the opencode bun-sqlite Database client. This file only declares the contract
 * so queue.ts can remain database-agnostic.
 */

import type { PromptSuggestion } from "./types"

export interface CollabDB {
  insertSuggestion(params: {
    id: string
    collabSessionId: string
    content: string
    authorGithubId: number
    authorGithubLogin: string
    status: "pending" | "approved"
    createdAt: number
    model?: string
    agent?: string
    variant?: string
  }): void

  updateSuggestionStatus(id: string, status: "approved" | "rejected" | "submitted"): void

  incrementVoteScore(suggestionId: string): { newScore: number }

  getApprovedQueue(collabSessionId: string): PromptSuggestion[]

  getPendingPool(collabSessionId: string): PromptSuggestion[]

  getSuggestion(id: string): PromptSuggestion | null
}
