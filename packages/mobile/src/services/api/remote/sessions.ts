import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isRootSession } from "@/utils/sessions"
import { apiClient } from "./client"
import { queryKeys } from "../keys"

// Types based on the API endpoints from the mobile plan
interface SessionResponse {
  id: string
  parentID?: string // API uses parentID (capital D)
  title: string
  version: string
  shareUrl?: string
  time: {
    created: number
    updated: number
  }
  revertMessageId?: string
  revertPartId?: string
  revertSnapshot?: string
  revertDiff?: string
}

interface CreateSessionRequest {
  title?: string
  parentId?: string
}

interface ShareSessionResponse {
  shareUrl: string
}

// Helper function to ensure API client uses active project
async function ensureActiveProjectConnection() {
  const db = (await import("@/db")).default
  const { projects } = await import("@/db/schema")
  const { eq } = await import("drizzle-orm")

  const activeProject = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1)
  if (!activeProject[0]) {
    throw new Error("No active project found. Please select a project first.")
  }

  // Ensure API client is using the active project's server URL
  await apiClient.updateBaseUrlFromString(activeProject[0].serverUrl)

  return activeProject[0]
}
// Query hooks
export function useRemoteSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.remote.sessions.lists(),
    queryFn: async (): Promise<SessionResponse[]> => {
      await ensureActiveProjectConnection()
      const response = await apiClient.axios.get("/session")
      return response.data.filter(isRootSession)
    },
    retry: 1, // Only retry once
    retryDelay: 1000, // Wait 1 second before retry
    staleTime: 30 * 1000, // 30 seconds
  })
}
export function useRemoteSessionQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.remote.sessions.detail(id),
    queryFn: async (): Promise<SessionResponse> => {
      await ensureActiveProjectConnection()
      const response = await apiClient.axios.get(`/session/${id}`)
      return response.data
    },
    enabled: !!id,
  })
}

// Mutation hooks
export function useCreateRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateSessionRequest): Promise<SessionResponse> => {
      await ensureActiveProjectConnection()
      const response = await apiClient.axios.post("/session", data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.lists() })
    },
  })
}

export function useDeleteRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await ensureActiveProjectConnection()
      await apiClient.axios.delete(`/session/${id}`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.lists() })
      queryClient.removeQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useInitRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await ensureActiveProjectConnection()
      await apiClient.axios.post(`/session/${id}/init`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useAbortRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await ensureActiveProjectConnection()
      await apiClient.axios.post(`/session/${id}/abort`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useShareRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<ShareSessionResponse> => {
      await ensureActiveProjectConnection()
      const response = await apiClient.axios.post(`/session/${id}/share`)
      return response.data
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}

export function useUnshareRemoteSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await ensureActiveProjectConnection()
      await apiClient.axios.delete(`/session/${id}/share`)
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.remote.sessions.detail(id) })
    },
  })
}
