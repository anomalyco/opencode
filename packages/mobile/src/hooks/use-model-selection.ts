/**
 * Model Selection Hook - Handles model fallback logic
 * Provides consistent model selection across the app
 */

import { useMemo } from "react"
import { useUserSettingsQuery } from "@/services/api/local/user-settings"
import { useLocalModelQuery } from "@/services/api/local/models"
import type { Session, UserSettings, Model } from "@/db/types"

export interface ModelSelection {
  providerId: string | undefined
  modelId: string | undefined
  source: "session" | "user-settings" | "hardcoded" | "none"
  model: Model | null | undefined
}

interface UseModelSelectionOptions {
  session?: Session | null
  userSettings?: UserSettings | null
}

const HARDCODED_DEFAULTS = {
  providerId: "anthropic",
  modelId: "claude-sonnet-4-20250514",
} as const

/**
 * Hook to get the current model selection with fallback chain:
 * 1. Session's selected model (modelId)
 * 2. User settings default
 * 3. Hardcoded fallback
 */
export const useModelSelection = (options: UseModelSelectionOptions = {}): ModelSelection => {
  const { data: userSettingsFromQuery } = useUserSettingsQuery()

  // Use provided userSettings or fall back to query
  const userSettings = options.userSettings ?? userSettingsFromQuery
  const session = options.session

  // Get model data for display purposes
  const { data: model } = useLocalModelQuery(session?.modelId || "")

  return useMemo(() => {
    // 1. Try session's selected model first
    if (session?.modelId) {
      const parts = session.modelId.split(":")
      if (parts.length === 2 && parts[0] && parts[1]) {
        return {
          providerId: parts[0],
          modelId: parts[1],
          source: "session" as const,
          model,
        }
      }
    }

    // 2. Fall back to user settings defaults
    if (userSettings?.defaultProviderId && userSettings?.defaultModelId) {
      return {
        providerId: userSettings.defaultProviderId,
        modelId: userSettings.defaultModelId,
        source: "user-settings" as const,
        model: null, // No model data for user settings defaults
      }
    }

    // 3. Final fallback to hardcoded defaults
    return {
      providerId: HARDCODED_DEFAULTS.providerId,
      modelId: HARDCODED_DEFAULTS.modelId,
      source: "hardcoded" as const,
      model: null, // No model data for hardcoded defaults
    }
  }, [session?.modelId, userSettings?.defaultProviderId, userSettings?.defaultModelId, model])
}
/**
 * Hook variant that only uses session data (for when you have a specific session)
 */
export const useSessionModelSelection = (session: Session | null | undefined): ModelSelection => {
  return useModelSelection({ session })
}
