/**
 * Navigation Refresh Hook - Refreshes data when navigating between pages
 * Ensures home page has fresh session data without impacting chat performance
 */

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"

export const useNavigationRefresh = (screenName: string) => {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Refresh sessions list when navigating to home page
    if (screenName === "home") {
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
    }
  }, [screenName, queryClient])
}
